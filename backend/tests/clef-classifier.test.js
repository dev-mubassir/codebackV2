import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  classifyWithClefOrFallback,
  extractClefCategory,
  formatClefAnalysis,
  determineFallbackReason,
  ConcurrencyLimiter,
  CLEF_CATEGORY_DEFINITIONS,
  CATEGORY_DEFAULTS,
  _resetCircuitBreaker,
  _getCircuitBreakerState,
  _setFetchImpl,
  _resetFetchImpl,
  MODEL_ID,
} from '../src/lib/ai/clefClassifier';
import aiService from '../src/services/aiService';
import { CATEGORIES } from '../src/lib/constants';

describe('Cloudflare Workers AI Clef Flash Classifier', () => {
  const origEnv = { ...process.env };

  const validGeminiFallbackResult = {
    category: 'pricing_inquiry',
    intent: 'pricing_inquiry',
    customerType: 'potential_buyer',
    purchaseIntent: 75,
    leadQuality: 70,
    commercialRelevance: 80,
    urgency: 40,
    riskLevel: 'LOW',
    scamProbability: 0,
    sentiment: 'neutral',
    confidence: 0.9,
    needsCreatorAttention: false,
    shouldAutoReply: false,
    summary: 'Asking for rates.',
    reason: 'Asks about pricing.',
    recommendedAction: 'ANSWER_PRICING',
    brandDeal: null,
    model: 'gemini-flash-lite-latest',
    provider: 'gemini',
    priorityScore: 75,
    priority: 'normal',
    failed: false,
    billable: true,
  };

  beforeEach(() => {
    process.env = { ...origEnv };
    _resetCircuitBreaker();
    _resetFetchImpl();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    _resetCircuitBreaker();
    _resetFetchImpl();
    vi.restoreAllMocks();
  });

  describe('Contract and Constants', () => {
    it('defines criteria for all 17 production categories', () => {
      expect(Object.keys(CLEF_CATEGORY_DEFINITIONS)).toHaveLength(CATEGORIES.length);
      for (const cat of CATEGORIES) {
        expect(CLEF_CATEGORY_DEFINITIONS[cat]).toBeDefined();
        expect(typeof CLEF_CATEGORY_DEFINITIONS[cat]).toBe('string');
        expect(CLEF_CATEGORY_DEFINITIONS[cat].length).toBeGreaterThan(5);
      }
    });

    it('defines default values for all 17 production categories', () => {
      for (const cat of CATEGORIES) {
        const def = CATEGORY_DEFAULTS[cat];
        expect(def).toBeDefined();
        expect(def.customerType).toBeDefined();
        expect(typeof def.purchaseIntent).toBe('number');
        expect(typeof def.leadQuality).toBe('number');
        expect(typeof def.riskLevel).toBe('string');
        expect(typeof def.summary).toBe('string');
      }
    });
  });

  describe('Positive control (Success)', () => {
    it('successfully classifies DM with Clef Flash and returns Gemini-shaped response', async () => {
      process.env.CLASSIFICATION_PROVIDER = 'clef';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account-id';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';

      const mockResponse = {
        success: true,
        errors: [],
        messages: [],
        result: {
          answers: {
            category: {
              choice: 'pricing_inquiry',
              confidence: 0.95,
            },
          },
          usage: {
            input_tokens: 24,
            output_tokens: 3,
          },
        },
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const fallbackFn = vi.fn().mockResolvedValue(validGeminiFallbackResult);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await classifyWithClefOrFallback({
        messageText: 'How much for a sponsorship post on your feed?',
        preferences: null,
        fallbackFn,
        computePriorityScore: (analysis) => ({ score: 75, priority: 'high' }),
        fetchImpl: mockFetch,
      });

      expect(fallbackFn).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify request URL and headers
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/test-account-id/ai/run/@cf/cloudflare/clef-flash');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-token');

      // Verify return shape matches Gemini contract
      expect(result.category).toBe('pricing_inquiry');
      expect(result.provider).toBe('cloudflare');
      expect(result.model).toBe(MODEL_ID);
      expect(result.failed).toBe(false);
      expect(result.billable).toBe(true);
      expect(result.confidence).toBe(0.95);
      expect(result.customerType).toBe('potential_buyer');
      expect(result.purchaseIntent).toBe(80);
      expect(result.riskLevel).toBe('LOW');
      expect(result.summary).toBe('Asking about pricing, rates, or package costs.');
      expect(result.reason).toContain('Classified as pricing_inquiry by Clef Flash');
      expect(result.brandDeal).toBeNull();
      expect(result.shouldAutoReply).toBe(false);

      // Structured log check: provider=clef, fallbackReason=null, no message text
      expect(logSpy).toHaveBeenCalled();
      const logEntry = JSON.parse(logSpy.mock.calls.find((call) => call[0].includes('dm_classification'))[0]);
      expect(logEntry.tag).toBe('dm_classification');
      expect(logEntry.provider).toBe('clef');
      expect(logEntry.fallbackReason).toBeNull();
      expect(logEntry.latencyMs).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(logEntry)).not.toContain('sponsorship');
      expect(JSON.stringify(logEntry)).not.toContain('test-token');
    });
  });

  describe('Error handling & Fallbacks to Gemini', () => {
    it('falls back to Gemini on HTTP 401 without retry', async () => {
      process.env.CLASSIFICATION_PROVIDER = 'clef';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
      process.env.CLOUDFLARE_API_TOKEN = 'bad-token';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }),
      });

      const fallbackFn = vi.fn().mockResolvedValue(validGeminiFallbackResult);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await classifyWithClefOrFallback({
        messageText: 'Hello',
        fallbackFn,
        fetchImpl: mockFetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1); // 401 does not retry
      expect(fallbackFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(validGeminiFallbackResult);

      const logEntry = JSON.parse(logSpy.mock.calls.find((call) => call[0].includes('dm_classification'))[0]);
      expect(logEntry.provider).toBe('gemini');
      expect(logEntry.fallbackReason).toBe('http_401');
    });

    it('falls back to Gemini on HTTP 429 without retry', async () => {
      process.env.CLASSIFICATION_PROVIDER = 'clef';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ success: false, errors: [{ message: 'Rate limit exceeded' }] }),
      });

      const fallbackFn = vi.fn().mockResolvedValue(validGeminiFallbackResult);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await classifyWithClefOrFallback({
        messageText: 'Hello',
        fallbackFn,
        fetchImpl: mockFetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1); // 429 does not retry
      expect(fallbackFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(validGeminiFallbackResult);

      const logEntry = JSON.parse(logSpy.mock.calls.find((call) => call[0].includes('dm_classification'))[0]);
      expect(logEntry.fallbackReason).toBe('http_429');
    });

    it('retries once on HTTP 500 before falling back to Gemini', async () => {
      process.env.CLASSIFICATION_PROVIDER = 'clef';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ success: false, errors: [{ message: 'Internal Server Error' }] }),
      });

      const fallbackFn = vi.fn().mockResolvedValue(validGeminiFallbackResult);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await classifyWithClefOrFallback({
        messageText: 'Hello',
        fallbackFn,
        fetchImpl: mockFetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(2); // 5xx retried once
      expect(fallbackFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(validGeminiFallbackResult);

      const logEntry = JSON.parse(logSpy.mock.calls.find((call) => call[0].includes('dm_classification'))[0]);
      expect(logEntry.fallbackReason).toBe('http_500');
    });

    it('falls back to Gemini on request timeout (AbortError)', async () => {
      process.env.CLASSIFICATION_PROVIDER = 'clef';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      const mockFetch = vi.fn().mockRejectedValue(abortError);
      const fallbackFn = vi.fn().mockResolvedValue(validGeminiFallbackResult);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await classifyWithClefOrFallback({
        messageText: 'Hello',
        fallbackFn,
        fetchImpl: mockFetch,
      });

      expect(fallbackFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(validGeminiFallbackResult);

      const logEntry = JSON.parse(logSpy.mock.calls.find((call) => call[0].includes('dm_classification'))[0]);
      expect(logEntry.fallbackReason).toBe('timeout');
    });

    it('falls back to Gemini on malformed or empty response', async () => {
      process.env.CLASSIFICATION_PROVIDER = 'clef';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: { answers: {} } }), // missing category
      });

      const fallbackFn = vi.fn().mockResolvedValue(validGeminiFallbackResult);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await classifyWithClefOrFallback({
        messageText: 'Hello',
        fallbackFn,
        fetchImpl: mockFetch,
      });

      expect(fallbackFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(validGeminiFallbackResult);

      const logEntry = JSON.parse(logSpy.mock.calls.find((call) => call[0].includes('dm_classification'))[0]);
      expect(logEntry.fallbackReason).toBe('malformed_response');
    });

    it('falls back to Gemini on unknown category label', async () => {
      process.env.CLASSIFICATION_PROVIDER = 'clef';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: { answers: { category: { choice: 'completely_made_up_category' } } },
        }),
      });

      const fallbackFn = vi.fn().mockResolvedValue(validGeminiFallbackResult);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await classifyWithClefOrFallback({
        messageText: 'Hello',
        fallbackFn,
        fetchImpl: mockFetch,
      });

      expect(fallbackFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(validGeminiFallbackResult);

      const logEntry = JSON.parse(logSpy.mock.calls.find((call) => call[0].includes('dm_classification'))[0]);
      expect(logEntry.fallbackReason).toBe('invalid_label');
    });

    it('falls back immediately when credentials are missing', async () => {
      process.env.CLASSIFICATION_PROVIDER = 'clef';
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_API_TOKEN;

      const mockFetch = vi.fn();
      const fallbackFn = vi.fn().mockResolvedValue(validGeminiFallbackResult);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await classifyWithClefOrFallback({
        messageText: 'Hello',
        fallbackFn,
        fetchImpl: mockFetch,
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(fallbackFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(validGeminiFallbackResult);

      const logEntry = JSON.parse(logSpy.mock.calls.find((call) => call[0].includes('dm_classification'))[0]);
      expect(logEntry.fallbackReason).toBe('missing_credentials');
    });

    it('falls back to Gemini on daily allocation exceeded error', async () => {
      process.env.CLASSIFICATION_PROVIDER = 'clef';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          errors: [{ message: 'Daily allocation exceeded for Workers AI' }],
        }),
      });

      const fallbackFn = vi.fn().mockResolvedValue(validGeminiFallbackResult);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await classifyWithClefOrFallback({
        messageText: 'Hello',
        fallbackFn,
        fetchImpl: mockFetch,
      });

      expect(fallbackFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(validGeminiFallbackResult);

      const logEntry = JSON.parse(logSpy.mock.calls.find((call) => call[0].includes('dm_classification'))[0]);
      expect(logEntry.fallbackReason).toBe('daily_allocation_exceeded');
    });
  });

  describe('Circuit Breaker', () => {
    it('trips after 5 consecutive failures and skips Clef for 60 seconds', async () => {
      process.env.CLASSIFICATION_PROVIDER = 'clef';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ success: false }),
      });

      const fallbackFn = vi.fn().mockResolvedValue(validGeminiFallbackResult);
      vi.spyOn(console, 'log').mockImplementation(() => {});

      // 5 consecutive failures
      for (let i = 0; i < 5; i++) {
        await classifyWithClefOrFallback({
          messageText: 'msg',
          fallbackFn,
          fetchImpl: mockFetch,
        });
      }

      const stateAfter5 = _getCircuitBreakerState();
      expect(stateAfter5.isOpen).toBe(true);

      const fetchCallsBefore6 = mockFetch.mock.calls.length;

      // 6th call should trip circuit breaker and skip fetch entirely
      const result6 = await classifyWithClefOrFallback({
        messageText: 'msg',
        fallbackFn,
        fetchImpl: mockFetch,
      });

      expect(mockFetch.mock.calls.length).toBe(fetchCallsBefore6); // no new fetch attempted
      expect(result6).toEqual(validGeminiFallbackResult);

      // Fast-forward 61 seconds: circuit should allow retry
      const origDateNow = Date.now;
      try {
        Date.now = () => origDateNow() + 61 * 1000;
        expect(_getCircuitBreakerState().isOpen).toBe(false);

        // Next call attempts Clef again
        await classifyWithClefOrFallback({
          messageText: 'msg',
          fallbackFn,
          fetchImpl: mockFetch,
        });
        expect(mockFetch.mock.calls.length).toBeGreaterThan(fetchCallsBefore6);
      } finally {
        Date.now = origDateNow;
      }
    });
  });

  describe('Message Truncation and Concurrency Cap', () => {
    it('truncates message text to 2,000 characters in the request payload', async () => {
      process.env.CLASSIFICATION_PROVIDER = 'clef';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: { answers: { category: { choice: 'fan', confidence: 0.99 } } },
        }),
      });

      const longMessage = 'A'.repeat(3000);
      await classifyWithClefOrFallback({
        messageText: longMessage,
        fallbackFn: vi.fn(),
        computePriorityScore: () => ({ score: 25, priority: 'low' }),
        fetchImpl: mockFetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const reqBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(reqBody.state.message).toHaveLength(2000);
      expect(reqBody.state.message).toBe('A'.repeat(2000));
    });

    it('enforces in-process concurrency cap', async () => {
      const limiter = new ConcurrencyLimiter(2);
      let active = 0;
      let maxActive = 0;

      const task = async () => {
        return limiter.run(async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 20));
          active--;
        });
      };

      await Promise.all([task(), task(), task(), task(), task()]);
      expect(maxActive).toBeLessThanOrEqual(2);
    });
  });

  describe('Integration with aiService.analyzeConversation', () => {
    it('routes through Clef when CLASSIFICATION_PROVIDER=clef', async () => {
      process.env.CLASSIFICATION_PROVIDER = 'clef';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            answers: {
              category: { choice: 'hot_lead', confidence: 0.98 },
            },
          },
        }),
      });

      _setFetchImpl(mockFetch);
      vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

      const result = await aiService.analyzeConversation({
        messageText: 'I want to hire you right now, can I book tomorrow?',
      });

      expect(result.provider).toBe('cloudflare');
      expect(result.model).toBe(MODEL_ID);
      expect(result.category).toBe('hot_lead');
      expect(result.failed).toBe(false);
      expect(result.billable).toBe(true);
      expect(result.customerType).toBe('hot_lead');
      expect(result.purchaseIntent).toBe(95);
      expect(result.summary).toBe('High-intent buyer ready to proceed immediately.');
      expect(result.needsCreatorAttention).toBe(true);
    });

    it('defaults to Gemini when CLASSIFICATION_PROVIDER is unset or gemini', async () => {
      delete process.env.CLASSIFICATION_PROVIDER;
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_API_TOKEN;

      const mockFetch = vi.fn();
      _setFetchImpl(mockFetch);

      // In unit test environment without real gemini key, analyzeConversation falls back to safe fallback
      const result = await aiService.analyzeConversation({
        messageText: 'What is your pricing?',
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.provider).not.toBe('cloudflare');
    });
  });

  describe('Live Smoke Test (Local Credentials Check)', () => {
    const hasLiveCreds = Boolean(
      process.env.CLOUDFLARE_ACCOUNT_ID?.trim() &&
      process.env.CLOUDFLARE_API_TOKEN?.trim()
    );

    it.skipIf(!hasLiveCreds)('smoke tests live Clef Flash API without exposing credentials', async () => {
      process.env.CLASSIFICATION_PROVIDER = 'clef';

      const result = await classifyWithClefOrFallback({
        messageText: 'How much do you charge for a video edit?',
        fallbackFn: () => ({ provider: 'gemini', failed: false }),
        computePriorityScore: (a) => ({ score: 75, priority: 'normal' }),
      });

      expect(result.failed).toBe(false);
      expect(CATEGORIES).toContain(result.category);
    });
  });
});

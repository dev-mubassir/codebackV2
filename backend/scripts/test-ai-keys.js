require('dotenv').config();
const axios = require('axios');

async function checkGemini() {
  const key = process.env.GEMINI_API_KEY;
  console.log('--- Checking Gemini ListModels ---');
  try {
    const res = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const models = res.data.models || [];
    console.log(`Found ${models.length} Gemini models:`);
    const genModels = models.filter(m => m.supportedGenerationMethods?.includes('generateContent'));
    console.log(genModels.map(m => m.name).slice(0, 15));

    // Test first working model
    for (const m of genModels.slice(0, 5)) {
      try {
        console.log(`Testing model: ${m.name}`);
        const testRes = await axios.post(`https://generativelanguage.googleapis.com/v1beta/${m.name}:generateContent?key=${key}`, {
          contents: [{ parts: [{ text: 'Respond with JSON {"greeting": "hello"}' }] }],
          generationConfig: { responseMimeType: 'application/json' }
        });
        console.log(`✅ ${m.name} SUCCESS:`, testRes.data?.candidates?.[0]?.content?.parts?.[0]?.text);
        break;
      } catch (err) {
        console.log(`❌ ${m.name} error:`, err.response?.data?.error?.message || err.message);
      }
    }
  } catch (err) {
    console.log('Gemini ListModels error:', err.response?.data || err.message);
  }
}

async function probeKey(key) {
  console.log('\n--- Probing Key across popular endpoints ---');
  const endpoints = [
    { name: 'xAI api.x.ai (grok-2)', url: 'https://api.x.ai/v1/chat/completions', body: { model: 'grok-2', messages: [{ role: 'user', content: 'hi' }] } },
    { name: 'xAI api.x.ai (grok-2-1212)', url: 'https://api.x.ai/v1/chat/completions', body: { model: 'grok-2-1212', messages: [{ role: 'user', content: 'hi' }] } },
    { name: 'xAI api.x.ai (grok-2-vision-1212)', url: 'https://api.x.ai/v1/chat/completions', body: { model: 'grok-2-vision-1212', messages: [{ role: 'user', content: 'hi' }] } },
    { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', body: { model: 'x-ai/grok-2-1212', messages: [{ role: 'user', content: 'hi' }] } },
    { name: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', body: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] } },
    { name: 'Together AI', url: 'https://api.together.xyz/v1/chat/completions', body: { model: 'meta-llama/Llama-3-8b-chat-hf', messages: [{ role: 'user', content: 'hi' }] } },
    { name: 'Perplexity', url: 'https://api.perplexity.ai/chat/completions', body: { model: 'sonar', messages: [{ role: 'user', content: 'hi' }] } },
    { name: 'Mistral', url: 'https://api.mistral.ai/v1/chat/completions', body: { model: 'mistral-small-latest', messages: [{ role: 'user', content: 'hi' }] } }
  ];

  for (const ep of endpoints) {
    try {
      process.stdout.write(`Testing ${ep.name}... `);
      const res = await axios.post(ep.url, ep.body, {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 6000
      });
      console.log(`✅ SUCCESS! Response:`, JSON.stringify(res.data?.choices?.[0]?.message?.content || res.data));
    } catch (err) {
      console.log(`❌ (${err.response?.status || err.message})`, err.response?.data?.error || err.response?.data?.message || '');
    }
  }
}

async function main() {
  await checkGemini();
  const key = process.env.OPENAI_API_KEY;
  if (key) await probeKey(key);
}

main();

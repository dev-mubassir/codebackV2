'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getOnboarding, saveOnboarding } from '@/lib/api';
import styles from './onboarding.module.css';

import { BUSINESS_CATEGORIES, DEFAULT_KNOWLEDGE_TEMPLATES, parseBusinessTypes, combineKnowledgeTemplates } from '@/lib/businessTemplates';

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Who are you?
  const [displayName, setDisplayName] = useState('');
  const [businessName, setBusinessName] = useState('');

  // Step 2: What do you do? (Multi-select)
  const [selectedCategories, setSelectedCategories] = useState(['video_editor']);
  const [customCategory, setCustomCategory] = useState('');

  // Step 3: Business Information
  const [description, setDescription] = useState('');
  const [productsServices, setProductsServices] = useState('');
  const [pricingInfo, setPricingInfo] = useState('');
  const [locationDelivery, setLocationDelivery] = useState('');
  const [policies, setPolicies] = useState('');
  const [paymentMethods, setPaymentMethods] = useState('');
  const [faqData, setFaqData] = useState('');
  const [aiInstructions, setAiInstructions] = useState('');
  const [tone, setTone] = useState('friendly');

  function applyCategoriesTemplates(catIds, force = false) {
    const combined = combineKnowledgeTemplates(catIds);
    if (!combined) return;

    if (force || !description) {
      setDescription(combined.description || '');
      setProductsServices(combined.productsServices || '');
      setPricingInfo(combined.pricingInfo || '');
      setLocationDelivery(combined.locationDelivery || '');
      setPolicies(combined.policies || '');
      setPaymentMethods(combined.paymentMethods || '');
      setFaqData(combined.faqData || '');
      setAiInstructions(combined.aiInstructions || '');
      setTone(combined.tone || 'friendly');
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const data = await getOnboarding();
        if (data.user) {
          setDisplayName(data.user.name || '');
        }
        if (data.businessProfile) {
          const bp = data.businessProfile;
          setBusinessName(bp.businessName || data.user?.name || '');
          const initialCats = parseBusinessTypes(bp.businessTypes, bp.primaryCategory);
          setSelectedCategories(initialCats.length > 0 ? initialCats : ['video_editor']);

          if (bp.description) {
            setDescription(bp.description);
            setProductsServices(bp.productsServices || '');
            setPricingInfo(bp.pricingInfo || '');
            setLocationDelivery(bp.locationDelivery || '');
            setPolicies(bp.policies || '');
            setPaymentMethods(bp.paymentMethods || '');
            setFaqData(bp.faqData || '');
            setAiInstructions(bp.aiInstructions || '');
            setTone(bp.tone || 'friendly');
          } else {
            // Apply default template for categories if profile has no saved description
            applyCategoriesTemplates(initialCats, true);
          }
        } else {
          applyCategoriesTemplates(['video_editor'], true);
        }
      } catch (err) {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  function handleCategoryToggle(catId) {
    setSelectedCategories((prev) => {
      const exists = prev.includes(catId);
      let updated;
      if (exists) {
        // Only remove if more than 1 selected
        updated = prev.length > 1 ? prev.filter((id) => id !== catId) : prev;
      } else {
        updated = [...prev, catId];
      }
      applyCategoriesTemplates(updated, true);
      return updated;
    });
  }

  async function handleFinish() {
    setSaving(true);
    setError('');

    try {
      const primaryCat = selectedCategories.includes('other') && customCategory ? customCategory : (selectedCategories[0] || 'other');
      await saveOnboarding({
        displayName,
        businessName: businessName || displayName,
        primaryCategory: primaryCat,
        businessTypes: JSON.stringify(selectedCategories),
        description,
        productsServices,
        pricingInfo,
        locationDelivery,
        policies,
        paymentMethods,
        faqData,
        aiInstructions,
        tone,
      });

      router.push('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save onboarding data. Please try again.');
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.onboardingLayout}>
        <div className="spinner spinner-lg" style={{ marginTop: '100px' }} />
      </div>
    );
  }

  return (
    <div className={styles.onboardingLayout}>
      <div className={styles.wizardContainer}>
        {/* Wizard Header */}
        <div className={styles.wizardHeader}>
          <div className={styles.logoBadge}>⚡</div>
          <h1 className={styles.wizardTitle}>Setup Your Business Profile</h1>
          <p className={styles.wizardSubtitle}>
            Help Codeback understand your business so AI can accurately qualify leads, answer customer questions, and protect your brand.
          </p>

          {/* Step Progress */}
          <div className={styles.stepProgress}>
            <div className={`${styles.stepDot} ${currentStep === 1 ? styles.stepActive : currentStep > 1 ? styles.stepCompleted : ''}`}>
              <span className={styles.stepNumber}>{currentStep > 1 ? '✓' : '1'}</span>
              <span>Identity</span>
            </div>
            <div className={styles.stepDivider} />
            <div className={`${styles.stepDot} ${currentStep === 2 ? styles.stepActive : currentStep > 2 ? styles.stepCompleted : ''}`}>
              <span className={styles.stepNumber}>{currentStep > 2 ? '✓' : '2'}</span>
              <span>Category</span>
            </div>
            <div className={styles.stepDivider} />
            <div className={`${styles.stepDot} ${currentStep === 3 ? styles.stepActive : ''}`}>
              <span className={styles.stepNumber}>3</span>
              <span>Knowledge Base</span>
            </div>
          </div>
        </div>

        {error && <div className={styles.errorBanner}>{error}</div>}

        {/* Step 1: Basic Identity */}
        {currentStep === 1 && (
          <div className={styles.card}>
            <h2 className={styles.stepTitle}>Step 1: What is your name and business?</h2>
            <p className={styles.stepDesc}>
              This will be used to personalize how AI addresses you and introduces your business.
            </p>

            <div className={styles.formGrid}>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Your Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Alex Rivera"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Business or Brand Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. PixelCraft Studios or Urban Kicks"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                />
                <span className={styles.formHint}>Leave blank if you operate under your personal name.</span>
              </div>
            </div>

            <div className={styles.wizardActions}>
              <div />
              <button
                className="btn btn-primary btn-md"
                onClick={() => setCurrentStep(2)}
                disabled={!displayName.trim()}
              >
                Next: What do you do? →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: What do you do? */}
        {currentStep === 2 && (
          <div className={styles.card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <h2 className={styles.stepTitle} style={{ margin: 0 }}>Step 2: What are your business types?</h2>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)', background: 'rgba(124, 58, 237, 0.1)', padding: '2px 10px', borderRadius: 'var(--radius-full)' }}>
                {selectedCategories.length} Selected
              </span>
            </div>
            <p className={styles.stepDesc}>
              Select all categories that match your business or services (multiple allowed). AI adapts its qualification logic to all selected offerings.
            </p>

            <div className={styles.categoryGrid}>
              {BUSINESS_CATEGORIES.map((cat) => {
                const isSelected = selectedCategories.includes(cat.id);
                return (
                  <div
                    key={cat.id}
                    className={`${styles.categoryCard} ${isSelected ? styles.categoryCardActive : ''}`}
                    onClick={() => handleCategoryToggle(cat.id)}
                  >
                    <span className={styles.categoryIcon}>{cat.icon}</span>
                    <span className={styles.categoryLabel}>
                      {isSelected ? `✓ ${cat.label}` : cat.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {selectedCategories.includes('other') && (
              <div className={styles.formRow} style={{ marginTop: '12px' }}>
                <label className={styles.formLabel}>Describe your custom business category</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Antique watches, 3D printing service, fitness trainer"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                />
              </div>
            )}

            <div className={styles.wizardActions}>
              <button className="btn btn-secondary btn-md" onClick={() => setCurrentStep(1)}>
                ← Back
              </button>
              <button className="btn btn-primary btn-md" onClick={() => setCurrentStep(3)}>
                Next: Business Knowledge Base →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Business Information */}
        {currentStep === 3 && (
          <div className={styles.card}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 className={styles.stepTitle}>Step 3: Train your AI Knowledge Base</h2>
                <p className={styles.stepDesc}>
                  Fill in your pricing, services, and policies. AI will ONLY answer customer questions based on facts provided here — it will never hallucinate or invent prices.
                </p>
              </div>
              {selectedCategory !== 'other' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => applyCategoryTemplate(selectedCategory, true)}
                  title="Restore default knowledge template for this category"
                  style={{ alignSelf: 'flex-start' }}
                >
                  ↺ Reset Defaults
                </button>
              )}
            </div>

            {selectedCategory !== 'other' ? (
              <div style={{ padding: '8px 12px', background: 'rgba(124, 58, 237, 0.08)', border: '1px solid rgba(124, 58, 237, 0.2)', borderRadius: 'var(--radius-md)', fontSize: '12px', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <span>✨</span>
                <span>Pre-filled with standard <strong>{BUSINESS_CATEGORIES.find(c => c.id === selectedCategory)?.label || 'Business'}</strong> knowledge base. Customize any detail below or keep as is.</span>
              </div>
            ) : (
              <div style={{ padding: '8px 12px', background: 'rgba(0, 0, 0, 0.03)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <span>⚡</span>
                <span>Custom business profile. Fill in your specific services, pricing, and rules below.</span>
              </div>
            )}

            <div className={styles.formGrid}>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Business Description</label>
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder="What do you do? e.g. High-converting short-form video editing for finance and tech creators."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Products or Services Offered</label>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="List your items or services. e.g. Reel editing, color grading, sound design, YouTube packages."
                  value={productsServices}
                  onChange={(e) => setProductsServices(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Pricing, Starting Rates & Packages</label>
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder="e.g. Reels: ₹750/each. 10-pack: ₹6,500. Custom projects require footage review."
                  value={pricingInfo}
                  onChange={(e) => setPricingInfo(e.target.value)}
                />
                <span className={styles.formHint}>AI will quote these exact rates to inquiring customers.</span>
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Turnaround Time, Location & Shipping / Delivery</label>
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder="e.g. Standard delivery is 48 hours. Express 24h available for +₹300."
                  value={policies}
                  onChange={(e) => setPolicies(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Payment Methods Accepted</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. UPI, Bank Transfer, PayPal, Stripe invoice"
                  value={paymentMethods}
                  onChange={(e) => setPaymentMethods(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Frequently Asked Questions (FAQs)</label>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="Q: Do you offer revisions? A: Yes, 2 rounds of free revisions included.&#10;Q: How do I send files? A: Via Google Drive or WeTransfer."
                  value={faqData}
                  onChange={(e) => setFaqData(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Custom AI Guidelines & Rules</label>
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder="e.g. Always ask the customer for their raw footage link before confirming final price. Never promise same-day delivery."
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Preferred AI Reply Tone</label>
                <select className="select" value={tone} onChange={(e) => setTone(e.target.value)}>
                  <option value="friendly">Friendly & Approachable</option>
                  <option value="professional">Professional & Direct</option>
                  <option value="casual">Casual & Conversational</option>
                  <option value="concise">Concise & Minimal</option>
                  <option value="warm">Warm & Welcoming</option>
                </select>
              </div>
            </div>

            <div className={styles.wizardActions}>
              <button className="btn btn-secondary btn-md" onClick={() => setCurrentStep(2)}>
                ← Back
              </button>
              <button
                className="btn btn-primary btn-lg"
                onClick={handleFinish}
                disabled={saving}
                id="finish-onboarding-btn"
              >
                {saving ? 'Saving Profile…' : '🚀 Finish Setup & Go to Dashboard'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

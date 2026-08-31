'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getOnboarding, saveOnboarding } from '@/lib/api';
import styles from './onboarding.module.css';

import { BUSINESS_CATEGORIES, parseBusinessTypes, combineKnowledgeTemplates } from '@/lib/businessTemplates';
import Icon from '@/app/components/Icon';
import { onboarding as t, settings as settingsCopy, common, errors } from '@/content/copy';
import { TONE_ORDER, toneLabel } from '@/content/labels';

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
  const [customPlaceholder] = useState(
    () => t.step2.customPlaceholders[Math.floor(Math.random() * t.step2.customPlaceholders.length)]
  );

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
      setError(err.response?.data?.error || errors.saveProfile);
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.onboardingLayout} aria-busy="true" aria-label={common.loading}>
        <div className="spinner spinner-lg" style={{ marginTop: '100px' }} />
      </div>
    );
  }

  return (
    <div className={styles.onboardingLayout}>
      <div className={styles.wizardContainer}>
        {/* Wizard Header */}
        <div className={styles.wizardHeader}>
          <div className={styles.logoBadge}><Icon name="zap" size={18} /></div>
          <h1 className={styles.wizardTitle}>{t.title}</h1>
          <p className={styles.wizardSubtitle}>{t.subtitle}</p>

          {/* Step Progress */}
          <div className={styles.stepProgress}>
            <div className={`${styles.stepDot} ${currentStep === 1 ? styles.stepActive : currentStep > 1 ? styles.stepCompleted : ''}`}>
              <span className={styles.stepNumber}>{currentStep > 1 ? <Icon name="check" size={11} /> : '1'}</span>
              <span>{t.steps.identity}</span>
            </div>
            <div className={styles.stepDivider} />
            <div className={`${styles.stepDot} ${currentStep === 2 ? styles.stepActive : currentStep > 2 ? styles.stepCompleted : ''}`}>
              <span className={styles.stepNumber}>{currentStep > 2 ? <Icon name="check" size={11} /> : '2'}</span>
              <span>{t.steps.category}</span>
            </div>
            <div className={styles.stepDivider} />
            <div className={`${styles.stepDot} ${currentStep === 3 ? styles.stepActive : ''}`}>
              <span className={styles.stepNumber}>3</span>
              <span>{t.steps.knowledge}</span>
            </div>
          </div>
        </div>

        {error && <div className={styles.errorBanner} role="alert">{error}</div>}

        {/* Step 1: Basic Identity */}
        {currentStep === 1 && (
          <div className={styles.card}>
            <h2 className={styles.stepTitle}>{t.step1.title}</h2>
            <p className={styles.stepDesc}>{t.step1.description}</p>

            <div className={styles.formGrid}>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>{t.step1.nameLabel}</label>
                <input
                  type="text"
                  className="input"
                  placeholder={t.step1.namePlaceholder}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>{t.step1.businessLabel}</label>
                <input
                  type="text"
                  className="input"
                  placeholder={t.step1.businessPlaceholder}
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                />
                <span className={styles.formHint}>{t.step1.businessHint}</span>
              </div>
            </div>

            <div className={styles.wizardActions}>
              <div />
              <button
                className="btn btn-primary btn-md"
                onClick={() => setCurrentStep(2)}
                disabled={!displayName.trim()}
              >
                {t.step1.next}
                <Icon name="arrowRight" size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: What do you do? */}
        {currentStep === 2 && (
          <div className={styles.card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <h2 className={styles.stepTitle} style={{ margin: 0 }}>{t.step2.title}</h2>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)', background: 'rgba(124, 58, 237, 0.1)', padding: '2px 10px', borderRadius: 'var(--radius-full)' }}>
                {selectedCategories.length} selected
              </span>
            </div>
            <p className={styles.stepDesc}>{t.step2.description}</p>

            <div className={styles.categoryGrid}>
              {BUSINESS_CATEGORIES.map((cat) => {
                const isSelected = selectedCategories.includes(cat.id);
                return (
                  <div
                    key={cat.id}
                    className={`${styles.categoryCard} ${isSelected ? styles.categoryCardActive : ''}`}
                    onClick={() => handleCategoryToggle(cat.id)}
                  >
                    <span className={styles.categoryIcon}><Icon name={cat.icon} size={18} /></span>
                    <span className={styles.categoryLabel}>
                      {isSelected && <Icon name="check" size={11} />} {cat.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {selectedCategories.includes('other') && (
              <div className={styles.formRow} style={{ marginTop: '12px' }}>
                <label className={styles.formLabel}>{t.step2.customLabel}</label>
                <input
                  type="text"
                  className="input"
                  placeholder={customPlaceholder}
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                />
              </div>
            )}

            <div className={styles.wizardActions}>
              <button className="btn btn-secondary btn-md" onClick={() => setCurrentStep(1)}>
                <Icon name="arrowLeft" size={14} /> {common.back}
              </button>
              <button className="btn btn-primary btn-md" onClick={() => setCurrentStep(3)}>
                {t.step2.next}
                <Icon name="arrowRight" size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Business Information */}
        {currentStep === 3 && (
          <div className={styles.card}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 className={styles.stepTitle}>{t.step3.title}</h2>
                <p className={styles.stepDesc}>{t.step3.description}</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => applyCategoriesTemplates(selectedCategories, true)}
                style={{ alignSelf: 'flex-start' }}
              >
                <Icon name="refresh" size={13} /> {t.step3.reset}
              </button>
            </div>

            <div style={{ padding: '8px 12px', background: 'rgba(124, 58, 237, 0.08)', border: '1px solid rgba(124, 58, 237, 0.2)', borderRadius: 'var(--radius-md)', fontSize: '12px', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <Icon name="sparkle" size={14} />
              <span>
                {t.step3.banner}{' '}
                <strong>
                  {selectedCategories
                    .map((id) => BUSINESS_CATEGORIES.find((c) => c.id === id)?.label || id)
                    .join(', ')}
                </strong>
                . {t.step3.bannerSuffix}
              </span>
            </div>

            <div className={styles.formGrid}>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>{settingsCopy.businessProfile.descriptionLabel}</label>
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder={settingsCopy.businessProfile.descriptionPlaceholder}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>{settingsCopy.businessProfile.servicesLabel}</label>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder={settingsCopy.businessProfile.servicesPlaceholder}
                  value={productsServices}
                  onChange={(e) => setProductsServices(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>{settingsCopy.businessProfile.pricingLabel}</label>
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder={settingsCopy.businessProfile.pricingPlaceholder}
                  value={pricingInfo}
                  onChange={(e) => setPricingInfo(e.target.value)}
                />
                <span className={styles.formHint}>{settingsCopy.businessProfile.pricingHint}</span>
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>{settingsCopy.businessProfile.policiesLabel}</label>
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder={settingsCopy.businessProfile.policiesPlaceholder}
                  value={policies}
                  onChange={(e) => setPolicies(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>{settingsCopy.businessProfile.paymentLabel}</label>
                <input
                  type="text"
                  className="input"
                  placeholder={settingsCopy.businessProfile.paymentPlaceholder}
                  value={paymentMethods}
                  onChange={(e) => setPaymentMethods(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>{settingsCopy.businessProfile.faqLabel}</label>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder={settingsCopy.businessProfile.faqPlaceholder}
                  value={faqData}
                  onChange={(e) => setFaqData(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>{settingsCopy.replies.instructionsLabel}</label>
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder={settingsCopy.replies.instructionsPlaceholder}
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel} htmlFor="onboarding-tone">{t.step3.toneLabel}</label>
                <select
                  id="onboarding-tone"
                  className="select"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                >
                  {TONE_ORDER.filter((v) => v !== 'custom').map((value) => (
                    <option key={value} value={value}>
                      {toneLabel(value).label} — {toneLabel(value).description}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.wizardActions}>
              <button className="btn btn-secondary btn-md" onClick={() => setCurrentStep(2)}>
                <Icon name="arrowLeft" size={14} /> {common.back}
              </button>
              <button
                className="btn btn-primary btn-lg"
                onClick={handleFinish}
                disabled={saving}
                id="finish-onboarding-btn"
              >
                {saving ? t.step3.finishing : t.step3.finish}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

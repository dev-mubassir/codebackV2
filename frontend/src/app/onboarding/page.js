'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getMe, getOnboarding, saveOnboarding } from '@/lib/api';
import { BUSINESS_CATEGORIES, combineKnowledgeTemplates, toggleBusinessType } from '@/lib/businessTemplates';
import Icon from '@/app/components/Icon';
import BrandLogo from '@/app/components/BrandLogo';
import { onboarding as t, settings as settingsCopy, common, errors } from '@/content/copy';
import { TONE_ORDER, toneLabel } from '@/content/labels';
import styles from './onboarding.module.css';

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
  const [selectedCategories, setSelectedCategories] = useState([]);
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
          }
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
      const updated = toggleBusinessType(prev, catId, { allowEmpty: true });
      if (updated.length > 0) applyCategoriesTemplates(updated, true);
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
        <div className="spinner spinner-lg" style={{ marginTop: '140px' }} />
      </div>
    );
  }

  return (
    <div className={styles.onboardingLayout}>
      {/* Background Decorative Grid & Ambient Cones */}
      <div className={styles.bgGridOverlay} aria-hidden="true" />
      <div className={styles.ambientGlow} aria-hidden="true" />

      {/* Top Brand Link */}
      <Link href="/" className={styles.topBrandNav} title="Back to Siffty.com">
        <BrandLogo size={36} className={styles.topBrandLogo} />
        <span className={styles.topBrandTitle}>Siffty</span>
      </Link>

      <div className={styles.wizardContainer}>
        {/* Wizard Header */}
        <div className={styles.wizardHeader}>
          <div className={styles.statusBadge}>
            <span className={styles.pulseDot} />
            <span>Workspace Setup • Step {currentStep} of 3</span>
          </div>
          <h1 className={styles.wizardTitle}>{t.title}</h1>
          <p className={styles.wizardSubtitle}>{t.subtitle}</p>

          {/* Step Progress Track */}
          <div className={styles.stepProgress} aria-label="Setup progress">
            <div className={[styles.stepDot, currentStep === 1 ? styles.stepActive : currentStep > 1 ? styles.stepCompleted : ''].join(' ')}>
              <span className={styles.stepNumber}>
                {currentStep > 1 ? <Icon name="check" size={13} /> : '1'}
              </span>
              <span>{t.steps.identity}</span>
            </div>

            <div className={styles.stepDivider} />

            <div className={[styles.stepDot, currentStep === 2 ? styles.stepActive : currentStep > 2 ? styles.stepCompleted : ''].join(' ')}>
              <span className={styles.stepNumber}>
                {currentStep > 2 ? <Icon name="check" size={13} /> : '2'}
              </span>
              <span>{t.steps.category}</span>
            </div>

            <div className={styles.stepDivider} />

            <div className={[styles.stepDot, currentStep === 3 ? styles.stepActive : ''].join(' ')}>
              <span className={styles.stepNumber}>3</span>
              <span>{t.steps.knowledge}</span>
            </div>
          </div>
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <Icon name="alertTriangle" size={16} />
            <span>{error}</span>
          </div>
        )}

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
                type="button"
                className={styles.btnPrimary}
                onClick={() => setCurrentStep(2)}
                disabled={!displayName.trim()}
                id="onboarding-step1-next"
              >
                <span>{t.step1.next}</span>
                <Icon name="arrowRight" size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: What do you do? (Business Categories) */}
        {currentStep === 2 && (
          <div className={styles.card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
              <h2 className={styles.stepTitle} style={{ margin: 0 }}>{t.step2.title}</h2>
              <span className={styles.counterBadge}>
                {selectedCategories.length} selected
              </span>
            </div>
            <p className={styles.stepDesc}>{t.step2.description}</p>
            {selectedCategories.length === 0 && (
              <p className={styles.formHint} role="status" style={{ color: '#d97706', marginBottom: '14px', fontWeight: 500 }}>
                {t.step2.pickOne}
              </p>
            )}

            <div className={styles.categoryGrid}>
              {BUSINESS_CATEGORIES.map((cat) => {
                const isSelected = selectedCategories.includes(cat.id);
                return (
                  <div
                    key={cat.id}
                    className={[styles.categoryCard, isSelected ? styles.categoryCardActive : ''].join(' ')}
                    onClick={() => handleCategoryToggle(cat.id)}
                    role="checkbox"
                    aria-checked={isSelected}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        handleCategoryToggle(cat.id);
                      }
                    }}
                  >
                    <div className={styles.categoryIconBox}>
                      <Icon name={cat.icon} size={18} />
                    </div>
                    <div className={styles.categoryTextWrap}>
                      <span className={styles.categoryLabel}>{cat.label}</span>
                      {cat.summary && <span className={styles.categorySummary}>{cat.summary}</span>}
                    </div>
                    {isSelected && (
                      <div className={styles.categoryCheckBadge}>
                        <Icon name="check" size={15} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {selectedCategories.includes('other') && (
              <div className={styles.formRow} style={{ marginTop: '14px', marginBottom: '10px' }}>
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
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setCurrentStep(1)}
              >
                <Icon name="arrowLeft" size={14} />
                <span>{common.back}</span>
              </button>

              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => setCurrentStep(3)}
                disabled={selectedCategories.length === 0}
                id="onboarding-step2-next"
              >
                <span>{t.step2.next}</span>
                <Icon name="arrowRight" size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Knowledge Base & AI Instructions */}
        {currentStep === 3 && (
          <div className={styles.card}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '8px' }}>
              <div>
                <h2 className={styles.stepTitle} style={{ margin: 0 }}>{t.step3.title}</h2>
                <p className={styles.stepDesc} style={{ margin: '4px 0 0' }}>{t.step3.description}</p>
              </div>

              <button
                type="button"
                className={styles.btnReset}
                onClick={() => applyCategoriesTemplates(selectedCategories, true)}
                title="Reset starter templates"
              >
                <Icon name="refresh" size={13} />
                <span>{t.step3.reset}</span>
              </button>
            </div>

            {/* Template Notice Banner */}
            <div className={styles.templateBanner} role="status">
              <Icon name="sparkle" size={16} />
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
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setCurrentStep(2)}
              >
                <Icon name="arrowLeft" size={14} />
                <span>{common.back}</span>
              </button>

              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleFinish}
                disabled={saving}
                id="finish-onboarding-btn"
              >
                <span>{saving ? t.step3.finishing : t.step3.finish}</span>
                <Icon name="arrowRight" size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Bottom Safety Guarantee */}
        <div className={styles.safetyGuarantee}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>AI Auto-Reply is Default OFF until reviewed &bull; Official Instagram Graph API</span>
        </div>
      </div>
    </div>
  );
}

'use client';

/**
 * Onboarding — three steps, then the dashboard.
 *
 * The DATA LAYER is master's: the same two endpoints, the same "nothing is
 * pre-selected" rule on step 2, the same starter-template behaviour, the same
 * payload shape on save. What changed is the surface, plus three things that
 * were wrong in master and are fixed here:
 *
 *   1. `locationDelivery` was filled by the starter template and POSTED on
 *      save, but no screen ever showed it. People stored text they had not
 *      read and could not correct. It is now a field like any other.
 *   2. Twelve of the twenty category cards drew no icon, because Icon returns
 *      null for a name it does not have and those twelve were never defined.
 *   3. A completed user could re-enter the wizard and an unfinished one could
 *      skip it by typing any other URL. Both are now redirects.
 *
 * NO AppShell. There is no navigation on this page because until it is
 * finished there is nowhere to navigate to.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getOnboarding, saveOnboarding, logout } from '@/lib/api';
import { BUSINESS_CATEGORIES, combineKnowledgeTemplates, toggleBusinessType } from '@/lib/businessTemplates';
import { takeDestination } from '@/lib/pendingDestination';
import Icon from '@/app/components/Icon';
import { Button, ErrorState, IconTile, Input, Skeleton } from '@/app/components/ui';
import BusinessProfileFields from '@/app/components/ui/BusinessProfileFields';
import { onboarding as t, settings as settingsCopy, common, nav as navCopy } from '@/content/copy';
import { errors } from '@/content/copy';
import styles from './onboarding.module.css';

const STEPS = [
  { n: 1, label: t.steps.identity },
  { n: 2, label: t.steps.category },
  { n: 3, label: t.steps.knowledge },
];

/** The eight text fields plus tone, exactly as the server stores them. */
const EMPTY_PROFILE = {
  description: '',
  productsServices: '',
  pricingInfo: '',
  locationDelivery: '',
  policies: '',
  paymentMethods: '',
  faqData: '',
  aiInstructions: '',
  tone: 'friendly',
};

export default function OnboardingPage() {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1
  const [displayName, setDisplayName] = useState('');
  const [businessName, setBusinessName] = useState('');

  // Step 2 — NOTHING is pre-selected, and the saved `businessTypes` are
  // deliberately not loaded. A new profile carries the `other` placeholder,
  // which is not an answer anybody gave; restoring it would put words in their
  // mouth and let them skip the step without choosing.
  const [selected, setSelected] = useState([]);
  const [customCategory, setCustomCategory] = useState('');
  const [customPlaceholder] = useState(
    () => t.step2.customPlaceholders[Math.floor(Math.random() * t.step2.customPlaceholders.length)],
  );

  // Step 3
  const [profile, setProfile] = useState(EMPTY_PROFILE);

  const applyTemplates = useCallback((catIds) => {
    const combined = combineKnowledgeTemplates(catIds);
    if (!combined) return;
    setProfile({
      description: combined.description || '',
      productsServices: combined.productsServices || '',
      pricingInfo: combined.pricingInfo || '',
      locationDelivery: combined.locationDelivery || '',
      policies: combined.policies || '',
      paymentMethods: combined.paymentMethods || '',
      faqData: combined.faqData || '',
      aiInstructions: combined.aiInstructions || '',
      tone: combined.tone || 'friendly',
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getOnboarding();
        if (cancelled) return;

        // Someone who has already finished does not belong here. Editing any
        // of this afterwards happens in Settings, which is the one place it
        // can be changed without also re-answering steps 1 and 2.
        if (data.onboardingCompleted) {
          router.replace('/dashboard');
          return;
        }

        setDisplayName(data.user?.name || '');
        const bp = data.businessProfile;
        if (bp) {
          setBusinessName(bp.businessName || data.user?.name || '');
          // Saved FACTS load; saved business TYPES do not (see above). A
          // profile with no description has never been filled in, so leaving
          // the fields empty lets the starter content land cleanly on step 2.
          if (bp.description) {
            setProfile({
              description: bp.description,
              productsServices: bp.productsServices || '',
              pricingInfo: bp.pricingInfo || '',
              locationDelivery: bp.locationDelivery || '',
              policies: bp.policies || '',
              paymentMethods: bp.paymentMethods || '',
              faqData: bp.faqData || '',
              aiInstructions: bp.aiInstructions || '',
              tone: bp.tone || 'friendly',
            });
          }
        }
      } catch {
        if (cancelled) return;
        // A 401 is the common case and means the session is gone.
        setLoadFailed(true);
        router.push('/login');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [router]);

  async function handleLogout() {
    await logout().catch(() => {});
    router.push('/login');
  }

  function handleToggleCategory(catId) {
    const next = toggleBusinessType(selected, catId, { allowEmpty: true });
    setSelected(next);
    // Picking a type rewrites step 3 from the starter templates — master's
    // behaviour, and the reason the "Reset to starter" button exists.
    if (next.length > 0) applyTemplates(next);
  }

  function handleProfileChange(name, value) {
    setProfile((prev) => ({ ...prev, [name]: value }));
  }

  async function handleFinish() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const primaryCategory = selected.includes('other') && customCategory
        ? customCategory
        : (selected[0] || 'other');

      await saveOnboarding({
        displayName,
        businessName: businessName || displayName,
        primaryCategory,
        businessTypes: JSON.stringify(selected),
        ...profile,
      });

      // Back to wherever the guard interrupted them, query string and all.
      // The one that matters is /dashboard?trial=<outcome>: connecting
      // Instagram grants a trial, and that parameter is the only place the
      // confirmation is ever shown. /dashboard when there is nothing stored.
      router.push(takeDestination() || '/dashboard');
    } catch (err) {
      // The server now refuses to mark setup complete unless the profile
      // actually saved, so staying on this step with the answers intact is
      // the correct thing to do: retrying will work.
      setError(err.response?.data?.error || errors.saveProfile);
      setSaving(false);
    }
  }

  const selectedLabels = selected
    .map((id) => BUSINESS_CATEGORIES.find((c) => c.id === id)?.label)
    .filter(Boolean);

  return (
    <div className={styles.page}>
      <div className={styles.wizard}>
        <header className={styles.header}>
          {/* The only way off this page. Internal routes now bounce an
              unfinished user back here, so without this there is no way to
              sign out of an account you are part-way through setting up. */}
          <button type="button" className={styles.signOut} onClick={handleLogout}>
            {navCopy.logOut}
          </button>

          <h1 className={styles.title}>{t.title}</h1>
          <p className={styles.subtitle}>{t.subtitle}</p>

          <ol className={styles.steps} aria-label={t.title}>
            {STEPS.map((s, i) => {
              const done = step > s.n;
              const current = step === s.n;
              return (
                <li
                  key={s.n}
                  className={styles.stepItem}
                  aria-current={current ? 'step' : undefined}
                >
                  <span
                    className={`${styles.stepMark} ${current ? styles.stepMarkCurrent : ''} ${done ? styles.stepMarkDone : ''}`}
                    aria-hidden="true"
                  >
                    {done ? <Icon name="check" size={11} /> : null}
                  </span>
                  <span className={`${styles.stepLabel} ${current ? styles.stepLabelCurrent : ''}`}>
                    {s.label}
                  </span>
                  {i < STEPS.length - 1 && <span className={styles.stepLine} aria-hidden="true" />}
                </li>
              );
            })}
          </ol>
        </header>

        <div className={styles.card}>
          {loading ? (
            <div className={styles.loading}>
              <Skeleton lines={5} height={40} />
            </div>
          ) : loadFailed ? (
            <ErrorState message={errors.generic} />
          ) : (
            <>
              {error && (
                <p className={styles.errorBanner} role="alert">{error}</p>
              )}

              {/* ---------- Step 1 ---------- */}
              {step === 1 && (
                <>
                  <h2 className={styles.stepTitle}>{t.step1.title}</h2>
                  <p className={styles.stepDesc}>{t.step1.description}</p>

                  <div className={styles.fields}>
                    <Input
                      label={t.step1.nameLabel}
                      placeholder={t.step1.namePlaceholder}
                      value={displayName}
                      maxLength={100}
                      autoFocus
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                    <Input
                      label={t.step1.businessLabel}
                      placeholder={t.step1.businessPlaceholder}
                      hint={t.step1.businessHint}
                      value={businessName}
                      maxLength={200}
                      onChange={(e) => setBusinessName(e.target.value)}
                    />
                  </div>

                  <div className={styles.actions}>
                    <span />
                    <Button
                      variant="primary"
                      onClick={() => setStep(2)}
                      disabled={!displayName.trim()}
                    >
                      {t.step1.next}
                      <Icon name="arrowRight" size={14} />
                    </Button>
                  </div>
                </>
              )}

              {/* ---------- Step 2 ---------- */}
              {step === 2 && (
                <>
                  <div className={styles.stepHead}>
                    <h2 className={styles.stepTitle}>{t.step2.title}</h2>
                    {selected.length > 0 && (
                      <span className={styles.count}>
                        {selected.length} {settingsCopy.businessProfile.selectedCount}
                      </span>
                    )}
                  </div>
                  <p className={styles.stepDesc}>{t.step2.description}</p>

                  {selected.length === 0 && (
                    <p className={styles.pickHint} role="status">{t.step2.pickOne}</p>
                  )}

                  <div className={styles.categoryGrid}>
                    {BUSINESS_CATEGORIES.map((cat) => {
                      const on = selected.includes(cat.id);
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          className={`${styles.categoryCard} ${on ? styles.categoryCardOn : ''}`}
                          onClick={() => handleToggleCategory(cat.id)}
                          aria-pressed={on}
                        >
                          {/* Every tile is neutral. A business type is not a
                              status, and twenty colours would be decoration. */}
                          <IconTile name={cat.icon} tone="neutral" />
                          <span className={styles.categoryText}>
                            <span className={styles.categoryLabel}>{cat.label}</span>
                            <span className={styles.categorySummary}>{cat.summary}</span>
                          </span>
                          {on && (
                            <span className={styles.categoryCheck} aria-hidden="true">
                              <Icon name="check" size={13} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {selected.includes('other') && (
                    <div className={styles.fields}>
                      <Input
                        label={t.step2.customLabel}
                        placeholder={customPlaceholder}
                        value={customCategory}
                        maxLength={100}
                        onChange={(e) => setCustomCategory(e.target.value)}
                      />
                    </div>
                  )}

                  <div className={styles.actions}>
                    <Button onClick={() => setStep(1)}>
                      <Icon name="arrowLeft" size={14} /> {common.back}
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => setStep(3)}
                      disabled={selected.length === 0}
                    >
                      {t.step2.next}
                      <Icon name="arrowRight" size={14} />
                    </Button>
                  </div>
                </>
              )}

              {/* ---------- Step 3 ---------- */}
              {step === 3 && (
                <>
                  <div className={styles.stepHead}>
                    <div>
                      <h2 className={styles.stepTitle}>{t.step3.title}</h2>
                      <p className={styles.stepDesc}>{t.step3.description}</p>
                    </div>
                    <Button size="sm" onClick={() => applyTemplates(selected)}>
                      <Icon name="refresh" size={13} /> {t.step3.reset}
                    </Button>
                  </div>

                  {/* Only when something was actually chosen — otherwise this
                      renders "Starter content loaded for ." */}
                  {selectedLabels.length > 0 && (
                    <div className={styles.banner}>
                      <IconTile name="zap" tone="accent" />
                      <p className={styles.bannerText}>
                        {t.step3.banner} <strong>{selectedLabels.join(', ')}</strong>.{' '}
                        {t.step3.bannerSuffix}
                      </p>
                    </div>
                  )}

                  <div className={styles.fields}>
                    <BusinessProfileFields
                      values={profile}
                      onChange={handleProfileChange}
                      disabled={saving}
                    />
                  </div>

                  <div className={styles.actions}>
                    <Button onClick={() => setStep(2)} disabled={saving}>
                      <Icon name="arrowLeft" size={14} /> {common.back}
                    </Button>
                    <Button variant="primary" onClick={handleFinish} loading={saving}>
                      {saving ? t.step3.finishing : t.step3.finish}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

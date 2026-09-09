'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/app/components/AppShell';
import { getMe, updateProfile, deleteAccount, getInstagramAuthUrl, getBusinessProfile } from '@/lib/api';
import { getCategoryMetadata, parseBusinessTypes } from '@/lib/businessTemplates';
import Icon from '@/app/components/Icon';
import PasswordInput from '@/app/components/PasswordInput';
import AuthErrorBanner from '@/app/components/AuthErrorBanner';
import { account as t, common, errors, empty, confirm as confirmCopy, toast, validation } from '@/content/copy';
import { replyModeLabel, roleLabel, connectionStatusLabel, tokenStatusLabel, toneLabel } from '@/content/labels';
import { formatDate } from '@/content/format';
import styles from './profile.module.css';

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [businessProfile, setBusinessProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Form states
  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [saveError, setSaveError] = useState('');

  // Delete modal states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    async function loadUser() {
      try {
        const [userData, profileData] = await Promise.all([
          getMe(),
          getBusinessProfile().catch(() => null),
        ]);
        setUser(userData);
        setName(userData.name || '');
        setBusinessProfile(profileData);
      } catch (err) {
        console.error('Failed to load profile:', err);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, [router]);

  async function handleProfileSave(e) {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess('');
    setSaveError('');

    if (newPassword && newPassword !== confirmPassword) {
      setSaveError(validation.passwordMismatch);
      setSaving(false);
      return;
    }

    try {
      const payload = { name };
      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }
      const res = await updateProfile(payload);
      setSaveSuccess(toast.profileSaved);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      if (res.user) {
        setUser((prev) => ({ ...prev, ...res.user }));
      }
    } catch (err) {
      setSaveError(err.response?.data?.error || errors.saveProfile);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirmText.trim() !== confirmCopy.deleteAccount.confirmWord) {
      setDeleteError(confirmCopy.deleteAccount.confirmMismatch);
      return;
    }

    setDeleting(true);
    setDeleteError('');

    try {
      await deleteAccount();
      // Redirect to landing page on successful deletion
      router.push('/?deleted=true');
    } catch (err) {
      setDeleteError(err.response?.data?.error || errors.deleteAccount);
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <AppShell activeRoute="/profile">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }} aria-busy="true" aria-label={common.loading}>
          <div className="spinner spinner-lg" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell activeRoute="/profile">
      <div className={styles.container}>
        {/* Renders the ?error= the backend redirected with. email_unverified
            additionally offers a resend, since knowing the problem is not the
            same as being able to fix it. */}
        <AuthErrorBanner />
        {/* Page Header */}
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>{t.title}</h1>
            <p className={styles.pageSubtitle}>{t.subtitle}</p>
          </div>
        </div>

        {/* Hero User Banner */}
        <div className={styles.profileHero}>
          <div className={styles.profileHeroLeft}>
            <div className={styles.heroAvatar}>
              {(user?.name || user?.email || 'U')[0].toUpperCase()}
            </div>
            <div className={styles.heroMeta}>
              <div className={styles.heroName}>{user?.name || common.notSet}</div>
              <div className={styles.heroEmail}>{user?.email}</div>
              <div className={styles.heroBadges}>
                {/* TEMP (pre-Meta-review): role badge hidden for non-admin users — "Standard account"
                    reads as a plan tier on a product with no tiers. Restore before launch. */}
                {user?.role === 'ADMIN' && (
                  <span className={styles.roleBadge}>
                    <Icon name="zap" size={12} /> {roleLabel(user?.role).label}
                  </span>
                )}
              </div>
            </div>
          </div>
          {user?.createdAt && (
            <div className={styles.heroDate}>
              {t.memberSince} {formatDate(user.createdAt)}
            </div>
          )}
        </div>

        {/* Alert Messages */}
        {saveSuccess && (
          <div className={styles.successBanner} role="status">
            <Icon name="check" size={14} /> {saveSuccess}
          </div>
        )}
        {saveError && (
          <div className={styles.errorBanner} role="alert">
            <Icon name="alertTriangle" size={14} /> {saveError}
          </div>
        )}

        {/* Personal Details & Credentials */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>{t.details.title}</h2>
              <p className={styles.cardDescription}>{t.details.description}</p>
            </div>
          </div>

          <form onSubmit={handleProfileSave}>
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{t.details.nameLabel}</label>
                <input
                  type="text"
                  className={styles.formInput}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.details.namePlaceholder}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{t.details.emailLabel}</label>
                <input
                  type="email"
                  className={styles.formInput}
                  value={user?.email || ''}
                  disabled
                />
                <span className={styles.formHint}>{t.details.emailHint}</span>
              </div>
            </div>

            <div style={{ margin: '20px 0 12px', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Icon name="lock" size={13} /> {t.details.passwordSection}
              </span>
            </div>

            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{t.details.currentPasswordLabel}</label>
                <PasswordInput
                  className={styles.formInput}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{t.details.newPasswordLabel}</label>
                <PasswordInput
                  className={styles.formInput}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t.details.newPasswordPlaceholder}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{t.details.confirmPasswordLabel}</label>
                <PasswordInput
                  className={styles.formInput}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>

            <div className={styles.formActions}>
              <button
                type="submit"
                className="btn btn-primary btn-md"
                disabled={saving}
                id="save-profile-btn"
              >
                {saving ? common.saving : common.save}
              </button>
            </div>
          </form>
        </div>

        {/* Business profile */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>{t.businessProfile.title}</h2>
              <p className={styles.cardDescription}>{t.businessProfile.description}</p>
            </div>
            <Link
              href="/settings?tab=profile"
              className="btn btn-secondary btn-sm"
              id="profile-edit-business-btn"
            >
              <Icon name="settings" size={13} /> {t.businessProfile.editAction}
            </Link>
          </div>

          {businessProfile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                {parseBusinessTypes(businessProfile.businessTypes, businessProfile.primaryCategory).map((catId) => (
                  <span
                    key={catId}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 12px',
                      borderRadius: 'var(--radius-full)',
                      background: 'rgba(124, 58, 237, 0.1)',
                      color: 'var(--color-primary)',
                      fontWeight: 700,
                      fontSize: '12px',
                    }}
                  >
                    <Icon name={getCategoryMetadata(catId).icon} size={12} />
                    <span>{getCategoryMetadata(catId).label}</span>
                  </span>
                ))}
                {businessProfile.businessName && (
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    • {businessProfile.businessName}
                  </span>
                )}
              </div>

              {businessProfile.description && (
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {businessProfile.description}
                </p>
              )}

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '10px',
                  padding: '12px',
                  background: 'var(--bg-surface-secondary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div>
                  <span className={styles.summaryLabel}>{t.businessProfile.servicesLabel}</span>
                  <div className={styles.summaryValue}>
                    {businessProfile.productsServices
                      ? businessProfile.productsServices.slice(0, 150) + (businessProfile.productsServices.length > 150 ? '…' : '')
                      : common.notConfigured}
                  </div>
                </div>

                <div>
                  <span className={styles.summaryLabel}>{t.businessProfile.pricingLabel}</span>
                  <div className={styles.summaryValue}>
                    {businessProfile.pricingInfo
                      ? businessProfile.pricingInfo.slice(0, 150) + (businessProfile.pricingInfo.length > 150 ? '…' : '')
                      : common.notConfigured}
                  </div>
                </div>

                {/* Reply mode and tone moved here from the separate "AI Business
                    Context" card below, which repeated this same profile under a
                    second name. */}
                <div>
                  <span className={styles.summaryLabel}>{t.businessProfile.replyModeLabel}</span>
                  <div className={styles.summaryValue}>
                    {replyModeLabel(businessProfile.autoReplyMode).label}
                  </div>
                </div>

                <div>
                  <span className={styles.summaryLabel}>{t.businessProfile.toneLabel}</span>
                  <div className={styles.summaryValue}>{toneLabel(businessProfile.tone).label}</div>
                </div>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t.businessProfile.empty}</p>
          )}
        </div>

        {/* Connected Instagram Accounts */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>{t.connectedAccounts.title}</h2>
              <p className={styles.cardDescription}>{t.connectedAccounts.description}</p>
            </div>
            <a
              href={getInstagramAuthUrl()}
              className="btn btn-secondary btn-sm"
              id="profile-connect-ig-btn"
            >
              <Icon name="plus" size={13} /> {t.connectedAccounts.connect}
            </a>
          </div>

          <div className={styles.accountList}>
            {(!user?.instagramAccounts || user.instagramAccounts.length === 0) ? (
              <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', padding: '8px 0' }}>
                {t.connectedAccounts.empty}
              </p>
            ) : (
              user.instagramAccounts.map((acc) => (
                <div key={acc.id} className={styles.accountCard}>
                  <div className={styles.accountLeft}>
                    <div className={styles.accountAvatar}>
                      {acc.igProfilePic ? (
                        <img src={acc.igProfilePic} alt="" />
                      ) : (
                        (acc.igUsername || 'IG')[0].toUpperCase()
                      )}
                    </div>
                    <div className={styles.accountMeta}>
                      <span className={styles.accountUsername}>@{acc.igUsername || 'account'}</span>
                      <span className={styles.accountStatus}>
                        <span
                          style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background:
                              acc.connectionStatus === 'DISCONNECTED' || acc.tokenStatus === 'NEEDS_RECONNECT'
                                ? 'var(--color-warning)'
                                : 'var(--color-success)',
                            display: 'inline-block',
                          }}
                        />
                        {acc.connectionStatus === 'DISCONNECTED'
                          ? connectionStatusLabel(acc.connectionStatus).label
                          : tokenStatusLabel(acc.tokenStatus).label}
                      </span>
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => router.push('/inbox')}
                  >
                    {t.connectedAccounts.openInbox}
                    <Icon name="arrowRight" size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* REMOVED-BY-COPY-AUDIT: duplicated card. "AI Business Context"
            restated the business profile card directly above it under a second
            name, and two of its four rows were wrong: "Primary Category"
            printed the raw stored value (`video_editor`), and "Auto-Reply Mode"
            printed the raw enum with a hardcoded `|| 'Smart'` fallback — so a
            brand-new account, whose stored mode is `human_only`, was told on
            its own account page that automatic sending was on. The two rows
            worth keeping (reply mode, reply tone) are now in the business
            profile card above, rendered through content/labels.js. Restore by
            re-adding this block — but reconcile it with that card first, and do
            not reintroduce the 'Smart' default.

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>AI Business Context</h2>
              <p className={styles.cardDescription}>Grounding profile used by AI to accurately answer customer inquiries.</p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => router.push('/settings')}>
              Manage Knowledge Base
            </button>
          </div>
          <div className={styles.businessGrid}>
            <div className={styles.businessItem}>
              <span className={styles.businessItemLabel}>Business Name</span>
              <span className={styles.businessItemValue}>{user?.businessProfile?.businessName || user?.name || 'Not set'}</span>
            </div>
            <div className={styles.businessItem}>
              <span className={styles.businessItemLabel}>Primary Category</span>
              <span className={styles.businessItemValue}>{user?.businessProfile?.primaryCategory}</span>
            </div>
            <div className={styles.businessItem}>
              <span className={styles.businessItemLabel}>Conversation Tone</span>
              <span className={styles.businessItemValue}>{user?.businessProfile?.tone || 'Friendly'}</span>
            </div>
            <div className={styles.businessItem}>
              <span className={styles.businessItemLabel}>Auto-Reply Mode</span>
              <span className={styles.businessItemValue}>{user?.businessProfile?.autoReplyMode || 'Smart'}</span>
            </div>
          </div>
        </div>
        */}

        {/* Danger Zone — Delete Account */}
        <div className={styles.dangerCard}>
          <div className={styles.dangerHeader}>
            <div>
              <h2 className={styles.dangerTitle}>{t.danger.title}</h2>
              <p className={styles.dangerText}>{t.danger.body}</p>
            </div>
          </div>
          <div className={styles.dangerActions}>
            <button
              className={`btn ${styles.btnDanger}`}
              onClick={() => {
                setDeleteConfirmText('');
                setDeleteError('');
                setShowDeleteModal(true);
              }}
              id="delete-account-btn"
            >
              <Icon name="trash" size={14} /> {t.danger.action}
            </button>
          </div>
        </div>
      </div>

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className={styles.modalOverlay} onClick={() => !deleting && setShowDeleteModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalIcon}><Icon name="alertTriangle" size={20} /></span>
              <h3 className={styles.modalTitle}>{confirmCopy.deleteAccount.title}</h3>
            </div>
            <p className={styles.modalBody}>
              This erases <strong>{user?.email}</strong> and everything below. It cannot be undone.
            </p>
            <ul style={{ fontSize: '11px', color: 'var(--text-secondary)', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {confirmCopy.deleteAccount.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div style={{ marginTop: '8px' }}>
              <label
                htmlFor="delete-confirm-input"
                style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-error)', display: 'block', marginBottom: '6px' }}
              >
                {confirmCopy.deleteAccount.confirmLabel}
              </label>
              <input
                id="delete-confirm-input"
                type="text"
                className={styles.formInput}
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={confirmCopy.deleteAccount.confirmPlaceholder}
                autoFocus
              />
            </div>
            {deleteError && <div className={styles.errorBanner}>{deleteError}</div>}
            <div className={styles.modalActions}>
              <button
                type="button"
                className="btn btn-secondary btn-md"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
              >
                {common.cancel}
              </button>
              <button
                type="button"
                className={`btn ${styles.btnDanger} btn-md`}
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText.trim() !== confirmCopy.deleteAccount.confirmWord || deleting}
                id="confirm-delete-account-btn"
              >
                {deleting ? common.deleting : confirmCopy.deleteAccount.action}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

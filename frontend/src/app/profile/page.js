'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/app/components/AppShell';
import { getMe, updateProfile, deleteAccount, getInstagramAuthUrl, getBusinessProfile } from '@/lib/api';
import { getCategoryMetadata, parseBusinessTypes } from '@/lib/businessTemplates';
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
      setSaveError('New passwords do not match');
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
      setSaveSuccess(res.message || 'Profile updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      if (res.user) {
        setUser((prev) => ({ ...prev, ...res.user }));
      }
    } catch (err) {
      setSaveError(err.response?.data?.error || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirmText.trim() !== 'DELETE') {
      setDeleteError('Please type DELETE exactly to confirm');
      return;
    }

    setDeleting(true);
    setDeleteError('');

    try {
      await deleteAccount();
      // Redirect to landing page on successful deletion
      router.push('/?deleted=true');
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Failed to delete account');
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <AppShell activeRoute="/profile">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div className="spinner spinner-lg" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell activeRoute="/profile">
      <div className={styles.container}>
        {/* Page Header */}
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>Account & Profile</h1>
            <p className={styles.pageSubtitle}>Manage your user identity, credentials, and connected platforms.</p>
          </div>
        </div>

        {/* Hero User Banner */}
        <div className={styles.profileHero}>
          <div className={styles.profileHeroLeft}>
            <div className={styles.heroAvatar}>
              {(user?.name || user?.email || 'U')[0].toUpperCase()}
            </div>
            <div className={styles.heroMeta}>
              <div className={styles.heroName}>{user?.name || 'User Profile'}</div>
              <div className={styles.heroEmail}>{user?.email}</div>
              <div className={styles.heroBadges}>
                <span className={styles.roleBadge}>
                  {user?.role === 'ADMIN' ? '⚡ Administrator' : '👤 User Account'}
                </span>
                <span className={styles.planBadge}>
                  {user?.subscription?.plan ? `${user.subscription.plan.toUpperCase()} Plan` : 'Free Plan'}
                </span>
              </div>
            </div>
          </div>
          {user?.createdAt && (
            <div className={styles.heroDate}>
              Member since {new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
            </div>
          )}
        </div>

        {/* Alert Messages */}
        {saveSuccess && <div className={styles.successBanner}>✓ {saveSuccess}</div>}
        {saveError && <div className={styles.errorBanner}>⚠️ {saveError}</div>}

        {/* Personal Details & Credentials */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>👤 Personal Details & Security</h2>
              <p className={styles.cardDescription}>Update your full name and password.</p>
            </div>
          </div>

          <form onSubmit={handleProfileSave}>
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Full Name</label>
                <input
                  type="text"
                  className={styles.formInput}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Email Address (Read-only)</label>
                <input
                  type="email"
                  className={styles.formInput}
                  value={user?.email || ''}
                  disabled
                />
              </div>
            </div>

            <div style={{ margin: '20px 0 12px', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                🔒 Change Password (Optional)
              </span>
            </div>

            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Current Password</label>
                <input
                  type="password"
                  className={styles.formInput}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>New Password</label>
                <input
                  type="password"
                  className={styles.formInput}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Confirm New Password</label>
                <input
                  type="password"
                  className={styles.formInput}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
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
                {saving ? 'Saving Changes…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>

        {/* Business Profile & Industry Type Card */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>🏢 Business Profile & Industry Category</h2>
              <p className={styles.cardDescription}>
                Your active business type card and knowledge base details used by AI for lead qualification and replies.
              </p>
            </div>
            <Link
              href="/settings?tab=profile"
              className="btn btn-secondary btn-sm"
              id="profile-edit-business-btn"
            >
              ✏️ Edit Business Profile & FAQs
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
                    <span>{getCategoryMetadata(catId).icon}</span>
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
                  <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>
                    Products / Services
                  </span>
                  <div style={{ fontSize: '12px', color: 'var(--text-primary)', marginTop: '2px', whiteSpace: 'pre-line' }}>
                    {businessProfile.productsServices ? businessProfile.productsServices.slice(0, 150) + (businessProfile.productsServices.length > 150 ? '…' : '') : 'Not configured'}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>
                    Pricing / Rates
                  </span>
                  <div style={{ fontSize: '12px', color: 'var(--text-primary)', marginTop: '2px', whiteSpace: 'pre-line' }}>
                    {businessProfile.pricingInfo ? businessProfile.pricingInfo.slice(0, 150) + (businessProfile.pricingInfo.length > 150 ? '…' : '') : 'Not configured'}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
              No business profile configured yet. Click "Edit Business Profile & FAQs" to choose your business type.
            </p>
          )}
        </div>

        {/* Connected Instagram Accounts */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>📸 Connected Instagram Accounts</h2>
              <p className={styles.cardDescription}>Accounts connected for automated DM analysis and intelligent replies.</p>
            </div>
            <a
              href={getInstagramAuthUrl()}
              className="btn btn-secondary btn-sm"
              id="profile-connect-ig-btn"
            >
              + Connect Instagram
            </a>
          </div>

          <div className={styles.accountList}>
            {(!user?.instagramAccounts || user.instagramAccounts.length === 0) ? (
              <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', padding: '8px 0' }}>
                No Instagram accounts connected yet. Click "+ Connect Instagram" to link your creator or business account.
              </p>
            ) : (
              user.instagramAccounts.map((acc) => (
                <div key={acc.id} className={styles.accountCard}>
                  <div className={styles.accountLeft}>
                    <div className={styles.accountAvatar}>
                      {acc.igProfilePic ? (
                        <img src={acc.igProfilePic} alt={acc.igUsername} />
                      ) : (
                        (acc.igUsername || 'IG')[0].toUpperCase()
                      )}
                    </div>
                    <div className={styles.accountMeta}>
                      <span className={styles.accountUsername}>@{acc.igUsername || 'account'}</span>
                      <span className={styles.accountStatus}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block' }} />
                        {acc.connectionStatus || 'CONNECTED'} ({acc.tokenStatus || 'VALID'})
                      </span>
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => router.push('/inbox')}
                  >
                    View Inbox ➤
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Business Profile Summary */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>🤖 AI Business Context</h2>
              <p className={styles.cardDescription}>Grounding profile used by AI to accurately answer customer inquiries.</p>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => router.push('/settings')}
            >
              ⚙️ Manage Knowledge Base
            </button>
          </div>

          <div className={styles.businessGrid}>
            <div className={styles.businessItem}>
              <span className={styles.businessItemLabel}>Business Name</span>
              <span className={styles.businessItemValue}>{user?.businessProfile?.businessName || user?.name || 'Not set'}</span>
            </div>
            <div className={styles.businessItem}>
              <span className={styles.businessItemLabel}>Primary Category</span>
              <span className={styles.businessItemValue}>{user?.businessProfile?.primaryCategory ? user.businessProfile.primaryCategory.replace('_', ' ') : 'General'}</span>
            </div>
            <div className={styles.businessItem}>
              <span className={styles.businessItemLabel}>Conversation Tone</span>
              <span className={styles.businessItemValue} style={{ textTransform: 'capitalize' }}>{user?.businessProfile?.tone || 'Friendly'}</span>
            </div>
            <div className={styles.businessItem}>
              <span className={styles.businessItemLabel}>Auto-Reply Mode</span>
              <span className={styles.businessItemValue} style={{ textTransform: 'capitalize' }}>{user?.businessProfile?.autoReplyMode || 'Smart'}</span>
            </div>
          </div>
        </div>

        {/* Danger Zone — Delete Account */}
        <div className={styles.dangerCard}>
          <div className={styles.dangerHeader}>
            <div>
              <h2 className={styles.dangerTitle}>⚠️ Danger Zone</h2>
              <p className={styles.dangerText}>
                Permanently delete your account and all associated data. Once deleted, your connected Instagram tokens, conversation history, AI business profile, and brand deals will be completely wiped from Codeback. This action cannot be undone.
              </p>
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
              🗑️ Delete Account
            </button>
          </div>
        </div>
      </div>

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className={styles.modalOverlay} onClick={() => !deleting && setShowDeleteModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalIcon}>🚨</span>
              <h3 className={styles.modalTitle}>Delete Your Codeback Account?</h3>
            </div>
            <p className={styles.modalBody}>
              This will permanently delete your account (<strong>{user?.email}</strong>) and all linked data:
            </p>
            <ul style={{ fontSize: '11px', color: 'var(--text-secondary)', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <li>All connected Instagram accounts and encrypted access tokens</li>
              <li>All DM conversations, message history, and AI summaries</li>
              <li>Your custom AI Business Profile and grounded rules</li>
              <li>All brand deal extractions and lead records</li>
            </ul>
            <div style={{ marginTop: '8px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-error)', display: 'block', marginBottom: '6px' }}>
                Type <strong>DELETE</strong> below to confirm:
              </label>
              <input
                type="text"
                className={styles.formInput}
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="Type DELETE"
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
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${styles.btnDanger} btn-md`}
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText.trim() !== 'DELETE' || deleting}
                id="confirm-delete-account-btn"
              >
                {deleting ? 'Deleting Account…' : 'Permanently Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

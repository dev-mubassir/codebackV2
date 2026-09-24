'use client';

/**
 * Account — your name and password, a read-only summary of the business
 * profile, the connected Instagram accounts, and deletion.
 *
 * The DATA LAYER is master's: the same three endpoints, the same payload shape
 * on save, the same typed-DELETE confirmation before anything is destroyed.
 *
 * WHAT CHANGED, AND WHY — the same audit that found `locationDelivery` in
 * Settings found three more of that shape here.
 *
 *   1. A NAME UNDER TWO CHARACTERS SAVED SILENTLY AND DID NOTHING.
 *      auth.js:1437 only applies the name when `name.trim().length >= 2`; it
 *      does not error otherwise. So typing "A" and pressing save showed
 *      "Account saved" while the name stayed as it was. The rule is now
 *      enforced here, with `validation.nameTooShort` — a string that already
 *      existed in copy.js and had never been used.
 *   2. The same for a short password: the server refuses under 6 characters
 *      with a 400, and the form checked only that the two fields matched, so
 *      the first feedback was a server error. `validation.passwordTooShort`
 *      also already existed, unused.
 *   3. The connected-account pictures were bare <img src={igProfilePic}>.
 *      Those are signed CDN URLs that expire in about four days — exactly what
 *      <Avatar> exists to survive.
 *
 * Also: the delete modal had its warning sentence hard-coded in JSX while
 * `confirm.deleteAccount.body` sat unused in copy.js, and it was hand-rolled
 * with no focus trap and no Escape. It uses the shared Modal now.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getMe, updateProfile, deleteAccount, getInstagramAuthUrl, getBusinessProfile,
} from '@/lib/api';
import { parseBusinessTypes, getCategoryMetadata } from '@/lib/businessTemplates';
import { rememberDestination } from '@/lib/pendingDestination';
import AppShell from '@/app/components/ui/AppShell';
import Icon from '@/app/components/Icon';
import PasswordInput from '@/app/components/PasswordInput';
import AuthErrorBanner from '@/app/components/AuthErrorBanner';
import {
  Avatar, Badge, Button, Card, EmptyState, IconTile, Input, Modal, Skeleton,
} from '@/app/components/ui';
import BusinessProfileFields, { ACCOUNT_SUMMARY_FIELDS } from '@/app/components/ui/BusinessProfileFields';
import {
  account as t, common, errors, confirm as confirmCopy, toast, validation, legal,
} from '@/content/copy';
import {
  replyModeLabel, roleLabel, connectionStatusLabel, tokenStatusLabel, toneLabel,
} from '@/content/labels';
import { formatDate } from '@/content/format';
import styles from './profile.module.css';

/** Mirrors auth.js:1437. Below this the server silently ignores the name. */
const MIN_NAME_LENGTH = 2;
/** Mirrors auth.js — the server 400s below this. */
const MIN_PASSWORD_LENGTH = 6;
/** No server cap exists on `name`; this is a UI guard, not a mirrored rule. */
const MAX_NAME_LENGTH = 100;

export default function ProfilePage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [businessProfile, setBusinessProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [saveError, setSaveError] = useState('');
  const [nameError, setNameError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const userData = await getMe();
        if (cancelled) return;
        if (!userData?.onboardingCompleted) {
          rememberDestination();
          router.replace('/onboarding');
          return;
        }
        setUser(userData);
        setName(userData.name || '');
        setBusinessProfile(await getBusinessProfile().catch(() => null));
      } catch {
        if (!cancelled) router.push('/login');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [router]);

  async function handleSave(e) {
    e.preventDefault();
    if (saving) return;

    setSaveSuccess('');
    setSaveError('');
    setNameError('');
    setPasswordError('');

    // Checked HERE because the server does not complain — it just declines to
    // apply the name, and the response still reads as success.
    if (name.trim().length < MIN_NAME_LENGTH) {
      setNameError(validation.nameTooShort);
      return;
    }
    if (newPassword) {
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        setPasswordError(validation.passwordTooShort);
        return;
      }
      if (newPassword !== confirmPassword) {
        setPasswordError(validation.passwordMismatch);
        return;
      }
    }

    setSaving(true);
    try {
      const payload = { name: name.trim() };
      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }
      const res = await updateProfile(payload);
      setSaveSuccess(toast.profileSaved);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      if (res.user) setUser((prev) => ({ ...prev, ...res.user }));
    } catch (err) {
      setSaveError(err.response?.data?.error || errors.saveProfile);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleteConfirmText.trim() !== confirmCopy.deleteAccount.confirmWord) {
      setDeleteError(confirmCopy.deleteAccount.confirmMismatch);
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteAccount();
      router.push('/?deleted=true');
    } catch (err) {
      setDeleteError(err.response?.data?.error || errors.deleteAccount);
      setDeleting(false);
    }
  }

  const accounts = user?.instagramAccounts || [];
  const typeIds = businessProfile
    ? parseBusinessTypes(businessProfile.businessTypes, businessProfile.primaryCategory)
    : [];
  const canDelete = deleteConfirmText.trim() === confirmCopy.deleteAccount.confirmWord;

  return (
    <AppShell user={user} title={t.title} activeRoute="/profile">
      <AuthErrorBanner />

      {/* No <h1> here: the AppShell topbar already renders one carrying the
          page name, and two headings saying "Account" is a duplicate for a
          reader and a second top-level heading for a screen reader. */}
      <header className={styles.pageHead}>
        <p className={styles.pageSub}>{t.subtitle}</p>
      </header>

      {loading ? (
        <Skeleton lines={6} height={44} />
      ) : (
        <div className={styles.stack}>
          {/* ---------- Who you are ---------- */}
          <div className={styles.identity}>
            <Avatar name={user?.name || user?.email} size={48} decorative />
            <div className={styles.identityMeta}>
              <span className={styles.identityName}>{user?.name || common.notSet}</span>
              <span className={styles.identityEmail}>{user?.email}</span>
            </div>
            <div className={styles.identityRight}>
              {/* Hidden for non-admins until launch: "Standard account" reads
                  as a plan tier on a product that has no tiers. */}
              {user?.role === 'ADMIN' && <Badge tone="accent">{roleLabel(user.role).label}</Badge>}
              {user?.createdAt && (
                <span className={styles.identityDate}>
                  {t.memberSince} {formatDate(user.createdAt)}
                </span>
              )}
            </div>
          </div>

          {/* ---------- Details and password ---------- */}
          <Card title={t.details.title} description={t.details.description}>
            <form onSubmit={handleSave} noValidate>
              <div className={styles.fieldStack}>
                <Input
                  label={t.details.nameLabel}
                  placeholder={t.details.namePlaceholder}
                  value={name}
                  error={nameError}
                  maxLength={MAX_NAME_LENGTH}
                  minLength={MIN_NAME_LENGTH}
                  disabled={saving}
                  onChange={(e) => { setName(e.target.value); setNameError(''); }}
                />

                <Input
                  label={t.details.emailLabel}
                  hint={t.details.emailHint}
                  type="email"
                  value={user?.email || ''}
                  disabled
                  readOnly
                />

                <div className={styles.sectionDivide}>
                  <IconTile name="lock" tone="neutral" />
                  <span className={styles.sectionLabel}>{t.details.passwordSection}</span>
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="current-password">
                    {t.details.currentPasswordLabel}
                  </label>
                  <PasswordInput
                    id="current-password"
                    className={styles.control}
                    value={currentPassword}
                    disabled={saving}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="new-password">
                    {t.details.newPasswordLabel}
                  </label>
                  <PasswordInput
                    id="new-password"
                    className={styles.control}
                    value={newPassword}
                    placeholder={t.details.newPasswordPlaceholder}
                    minLength={MIN_PASSWORD_LENGTH}
                    disabled={saving}
                    onChange={(e) => { setNewPassword(e.target.value); setPasswordError(''); }}
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="confirm-password">
                    {t.details.confirmPasswordLabel}
                  </label>
                  <PasswordInput
                    id="confirm-password"
                    className={styles.control}
                    value={confirmPassword}
                    disabled={saving}
                    onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(''); }}
                  />
                  {passwordError && <span className={styles.fieldError} role="alert">{passwordError}</span>}
                </div>
              </div>

              <div className={styles.formActions}>
                {saveError && <p className={styles.inlineError} role="alert">{saveError}</p>}
                {saveSuccess && !saveError && (
                  <p className={styles.savedNote} role="status">
                    <Icon name="check" size={14} /> {saveSuccess}
                  </p>
                )}
                <Button type="submit" variant="primary" loading={saving}>
                  {saving ? common.saving : common.save}
                </Button>
              </div>
            </form>
          </Card>

          {/* ---------- Business profile, read only ---------- */}
          <Card
            title={t.businessProfile.title}
            description={t.businessProfile.description}
            actions={(
              <Link href="/settings?tab=profile" className={styles.cardLink}>
                <Icon name="settings" size={13} />
                {t.businessProfile.editAction}
              </Link>
            )}
          >
            {businessProfile ? (
              <div className={styles.fieldStack}>
                {typeIds.length > 0 && (
                  <div className={styles.typeRow}>
                    {typeIds.map((id) => (
                      <Badge key={id} tone="neutral">{getCategoryMetadata(id).label}</Badge>
                    ))}
                  </div>
                )}

                {/* The same definitions Settings and onboarding edit, rendered
                    read-only. A fourth hand-written copy of these labels is how
                    the first three drifted apart. */}
                <BusinessProfileFields
                  values={businessProfile}
                  fields={ACCOUNT_SUMMARY_FIELDS}
                  readOnly
                />

                <div className={styles.miniGrid}>
                  <div className={styles.readField}>
                    <span className={styles.readLabel}>{t.businessProfile.replyModeLabel}</span>
                    <p className={styles.readValue}>{replyModeLabel(businessProfile.autoReplyMode).label}</p>
                  </div>
                  <div className={styles.readField}>
                    <span className={styles.readLabel}>{t.businessProfile.toneLabel}</span>
                    <p className={styles.readValue}>{toneLabel(businessProfile.tone).label}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className={styles.emptyText}>{t.businessProfile.empty}</p>
            )}
          </Card>

          {/* ---------- Connected accounts ---------- */}
          <Card
            title={t.connectedAccounts.title}
            description={t.connectedAccounts.description}
            actions={(
              <Button size="sm" onClick={() => { window.location.href = getInstagramAuthUrl(); }}>
                <Icon name="plus" size={13} />
                {t.connectedAccounts.connect}
              </Button>
            )}
            flush={accounts.length > 0}
          >
            {accounts.length === 0 ? (
              <EmptyState icon="instagram" title={t.connectedAccounts.title} body={t.connectedAccounts.empty} />
            ) : (
              <div className={styles.accountList}>
                {accounts.map((acc) => {
                  const disconnected = acc.connectionStatus === 'DISCONNECTED';
                  const status = disconnected
                    ? connectionStatusLabel(acc.connectionStatus)
                    : tokenStatusLabel(acc.tokenStatus);
                  return (
                    <div key={acc.id} className={styles.accountRow}>
                      {/* <Avatar>, not a bare <img>: igProfilePic is a signed
                          CDN URL that expires in about four days. */}
                      <Avatar src={acc.igProfilePic} name={acc.igUsername} size={32} decorative />
                      <span className={styles.accountName}>@{acc.igUsername || 'account'}</span>
                      <Badge tone={status.tone === 'positive' ? 'positive' : 'warning'}>
                        {status.label}
                      </Badge>
                      {/* master pushed a bare /inbox here, dropping the account
                          the row is about. */}
                      <Button size="sm" onClick={() => router.push(`/inbox?accountId=${acc.id}`)}>
                        {t.connectedAccounts.openInbox}
                        <Icon name="arrowRight" size={13} />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* ---------- Danger zone ---------- */}
          <section className={styles.danger} aria-labelledby="danger-heading">
            <div className={styles.dangerHead}>
              <IconTile name="alertTriangle" tone="danger" />
              <div>
                <h2 className={styles.dangerTitle} id="danger-heading">{t.danger.title}</h2>
                <p className={styles.dangerBody}>{t.danger.body}</p>
              </div>
            </div>
            <Button
              variant="danger"
              onClick={() => {
                setDeleteConfirmText('');
                setDeleteError('');
                setShowDeleteModal(true);
              }}
            >
              <Icon name="trash" size={14} />
              {t.danger.action}
            </Button>
          </section>

          <nav className={styles.legalNav} aria-label={legal.footerLabel}>
            <Link href="/privacy">{legal.footerLinks.privacy}</Link>
            <Link href="/data-deletion">{legal.footerLinks.dataDeletion}</Link>
            <Link href="/support">{legal.footerLinks.support}</Link>
          </nav>
        </div>
      )}

      {showDeleteModal && (
        <Modal
          title={confirmCopy.deleteAccount.title}
          onClose={() => { if (!deleting) setShowDeleteModal(false); }}
          actions={(
            <>
              <Button onClick={() => setShowDeleteModal(false)} disabled={deleting}>
                {common.cancel}
              </Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={!canDelete}
                loading={deleting}
              >
                {deleting ? common.deleting : confirmCopy.deleteAccount.action}
              </Button>
            </>
          )}
        >
          <p className={styles.modalBody}>{confirmCopy.deleteAccount.body}</p>
          <ul className={styles.modalList}>
            {confirmCopy.deleteAccount.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <Input
            label={confirmCopy.deleteAccount.confirmLabel}
            placeholder={confirmCopy.deleteAccount.confirmPlaceholder}
            value={deleteConfirmText}
            error={deleteError}
            disabled={deleting}
            autoFocus
            onChange={(e) => { setDeleteConfirmText(e.target.value); setDeleteError(''); }}
          />
        </Modal>
      )}
    </AppShell>
  );
}

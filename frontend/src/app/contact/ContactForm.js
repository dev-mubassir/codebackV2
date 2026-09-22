'use client';

/**
 * The enquiry form on /contact and /contact/enterprise.
 *
 * Preserves all submission logic, honeypot spam protection,
 * and error/sent states while matching the Siffty landing page theme.
 */

import { useState } from 'react';
import { sendContactEnquiry } from '@/lib/api';
import { contactPage } from '@/content/copy';
import styles from '@/app/components/public/public.module.css';

export default function ContactForm({ kind = 'support', supportEmail }) {
  const t = contactPage.form;
  const isEnterprise = kind === 'enterprise';
  const [state, setState] = useState('idle'); // idle | sending | sent | failed
  const [failure, setFailure] = useState('');

  async function onSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key) => String(form.get(key) || '').trim();

    const payload = { name: text('name'), email: text('email'), message: text('message') };
    if (isEnterprise) {
      payload.company = text('company');
      if (text('igAccounts')) payload.igAccounts = text('igAccounts');
    }
    if (text('website')) payload.website = text('website');

    setState('sending');
    setFailure('');
    try {
      await sendContactEnquiry(kind, payload);
      setState('sent');
    } catch (err) {
      setState('failed');
      const status = err.response?.status;
      const serverMessage = status === 400 || status === 429 ? err.response?.data?.error : null;
      setFailure(serverMessage ? `${serverMessage} — ${t.failed(supportEmail)}` : t.failed(supportEmail));
    }
  }

  if (state === 'sent') {
    return (
      <div className={styles.statusSent} role="status">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
        <span>{t.sent}</span>
      </div>
    );
  }

  return (
    <form className={styles.formGrid} onSubmit={onSubmit} noValidate={false}>
      <div className={styles.formField}>
        <label className={styles.formLabel} htmlFor={`${kind}-name`}>
          {t.name}
        </label>
        <input
          id={`${kind}-name`}
          name="name"
          className={styles.formInput}
          required
          maxLength={120}
          autoComplete="name"
          placeholder="e.g. Alex Morgan"
        />
      </div>

      <div className={styles.formField}>
        <label className={styles.formLabel} htmlFor={`${kind}-email`}>
          {t.email}
        </label>
        <input
          id={`${kind}-email`}
          name="email"
          type="email"
          className={styles.formInput}
          required
          maxLength={254}
          autoComplete="email"
          placeholder="alex@yourbrand.com"
        />
        <span className={styles.formHint}>{t.emailHint}</span>
      </div>

      {isEnterprise && (
        <>
          <div className={styles.formField}>
            <label className={styles.formLabel} htmlFor={`${kind}-company`}>
              {t.company}
            </label>
            <input
              id={`${kind}-company`}
              name="company"
              className={styles.formInput}
              required
              maxLength={160}
              autoComplete="organization"
              placeholder="e.g. Acme Agency LLC"
            />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel} htmlFor={`${kind}-ig`}>
              {t.igAccounts}
            </label>
            <input
              id={`${kind}-ig`}
              name="igAccounts"
              className={styles.formInput}
              maxLength={40}
              inputMode="numeric"
              placeholder="e.g. 5"
            />
          </div>
        </>
      )}

      <div className={styles.formField}>
        <label className={styles.formLabel} htmlFor={`${kind}-message`}>
          {t.message}
        </label>
        <textarea
          id={`${kind}-message`}
          name="message"
          className={styles.formTextarea}
          required
          minLength={10}
          maxLength={5000}
          rows={5}
          placeholder="Describe your inquiry, setup requirements, or questions..."
        />
      </div>

      {/* Honeypot: invisible to people, filled by naive bots. */}
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor={`${kind}-website`}>{t.honeypot}</label>
        <input id={`${kind}-website`} name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div style={{ marginTop: '8px' }}>
        <button
          type="submit"
          className={styles.btnPillPrimary}
          disabled={state === 'sending'}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {state === 'sending' ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
              </svg>
              <span>{t.sending}</span>
            </>
          ) : (
            <>
              <span>{t.submit}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </>
          )}
        </button>
      </div>

      {state === 'failed' && (
        <div className={styles.statusError} role="alert">
          {failure}
        </div>
      )}
    </form>
  );
}

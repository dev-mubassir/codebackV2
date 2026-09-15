'use client';

/**
 * The enquiry form on /contact and /contact/enterprise.
 *
 * The only client-side part of either page: the email address, reply time and
 * business details around it are server-rendered, so they are readable with
 * JavaScript off and never depend on this request succeeding.
 *
 * A failed send never claims success. It says so and repeats the address to
 * write to instead.
 */

import { useState } from 'react';
import { sendContactEnquiry } from '@/lib/api';
import { contactPage } from '@/content/copy';
import styles from './contact.module.css';

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
      // A validation or rate-limit message names what to fix; anything else is
      // on our side, so point to the address that does not depend on this form.
      const serverMessage = status === 400 || status === 429 ? err.response?.data?.error : null;
      setFailure(serverMessage ? `${serverMessage} — ${t.failed(supportEmail)}` : t.failed(supportEmail));
    }
  }

  if (state === 'sent') {
    return (
      <p className={styles.sent} role="status">
        {t.sent}
      </p>
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate={false}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${kind}-name`}>{t.name}</label>
        <input id={`${kind}-name`} name="name" className="input" required maxLength={120} autoComplete="name" />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${kind}-email`}>{t.email}</label>
        <input id={`${kind}-email`} name="email" type="email" className="input" required maxLength={254} autoComplete="email" />
        <span className={styles.hint}>{t.emailHint}</span>
      </div>

      {isEnterprise && (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${kind}-company`}>{t.company}</label>
            <input id={`${kind}-company`} name="company" className="input" required maxLength={160} autoComplete="organization" />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${kind}-ig`}>{t.igAccounts}</label>
            <input id={`${kind}-ig`} name="igAccounts" className="input" maxLength={40} inputMode="numeric" />
          </div>
        </>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${kind}-message`}>{t.message}</label>
        <textarea id={`${kind}-message`} name="message" className="textarea" required minLength={10} maxLength={5000} rows={6} />
      </div>

      {/* Honeypot: invisible to people and to assistive tech, filled by naive bots. */}
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor={`${kind}-website`}>{t.honeypot}</label>
        <input id={`${kind}-website`} name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>
          {state === 'sending' ? t.sending : t.submit}
        </button>
      </div>

      {state === 'failed' && (
        <p className={styles.failed} role="alert">
          {failure}
        </p>
      )}
    </form>
  );
}

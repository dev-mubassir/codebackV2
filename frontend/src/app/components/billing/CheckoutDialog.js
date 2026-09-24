'use client';

/**
 * The one thing standing between a customer and Cashfree's hosted page: a
 * mobile number.
 *
 * WHY THIS DIALOG EXISTS AT ALL. Cashfree's Orders API requires
 * customer_phone, and Siffty's User model has no phone column — an account
 * can be created with an email and a password alone. So there is exactly one
 * field to collect, and this dialog collects it and nothing else. It is not
 * a payment form: no card number, no CVV, no expiry, no name-on-card. All of
 * that is entered on Cashfree's own origin, which is the entire point of the
 * hosted flow.
 *
 * The number is passed straight through to the checkout call and never
 * persisted — see the help text, which says so plainly rather than leaving
 * the customer to wonder why a DM tool wants their phone number.
 *
 * The amount shown is the one the API returned for the item being bought.
 * Nothing here knows a price.
 */

import { useEffect, useRef, useState } from 'react';
import { billing } from '@/content/billingCopy';
import styles from './billing.module.css';

/** Cashfree's own constraint: exactly ten digits. Validated here so a typo costs a keystroke, not a round trip. */
const PHONE_PATTERN = /^\d{10}$/;

export default function CheckoutDialog({
  open,
  title,
  /** Already formatted by lib/pricing.formatPrice — this component never formats money. */
  formattedAmount,
  pending,
  error,
  /** { title, body } when this purchase is a downgrade that has to wait — explained in place of the form. */
  blocked = null,
  onSubmit,
  onClose,
}) {
  const [phone, setPhone] = useState('');
  const [localError, setLocalError] = useState(null);
  const inputRef = useRef(null);

  // A dialog opened from an email link (?renew=STARTER) lands the customer
  // here with no idea they were about to type: focusing the only field makes
  // the next action obvious without a second click.
  //
  // Nothing resets `phone`/`localError` here, and nothing needs to: the page
  // gives this component a key derived from the item being bought, so a
  // different purchase is a different element and starts with fresh state.
  useEffect(() => {
    if (!open) return undefined;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Escape closes, the way every other dismissible layer in the product does.
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape' && !pending) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, pending, onClose]);

  if (!open) return null;

  // A downgrade that must wait: say when, and offer nothing to pay. Not the
  // red error box — this is not something that went wrong.
  if (blocked) {
    return (
      <div
        className={styles.dialogOverlay}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={blocked.title}>
          <h2 className={styles.dialogTitle}>{blocked.title}</h2>
          <p className={styles.fieldHelp}>{blocked.body}</p>
          <div className={styles.dialogActions}>
            <button type="button" className={styles.btnPrimary} onClick={onClose}>
              {billing.planChange.closeButton}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!PHONE_PATTERN.test(phone)) {
      setLocalError(billing.errors.invalidPhone);
      return;
    }
    setLocalError(null);
    onSubmit(phone);
  }

  return (
    <div
      className={styles.dialogOverlay}
      // Clicking the backdrop dismisses, but NEVER mid-payment: the order row
      // already exists server-side by then and the browser is navigating away.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <h2 className={styles.dialogTitle}>{title}</h2>

        <div className={styles.dialogAmount}>
          <span className={styles.label}>{billing.checkout.amountLabel}</span>
          <span className={styles.dialogAmountValue}>{formattedAmount}</span>
        </div>

        {(localError || error) && (
          <div className={styles.dialogError} role="alert">
            {localError || error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="billing-checkout-phone">
              {billing.checkout.phoneLabel}
            </label>
            <input
              id="billing-checkout-phone"
              ref={inputRef}
              className={styles.input}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              placeholder={billing.checkout.phonePlaceholder}
              value={phone}
              // Strip everything that is not a digit as it is typed: people
              // paste numbers with +91, spaces and hyphens, and rejecting
              // those is a worse experience than quietly accepting them.
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(-10))}
              disabled={pending}
            />
            <p className={styles.fieldHelp}>{billing.checkout.phoneHelp}</p>
          </div>

          <p className={styles.fieldHelp}>{billing.checkout.hostedNote}</p>

          <div className={styles.dialogActions}>
            <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={pending}>
              {billing.checkout.cancelButton}
            </button>
            <button type="submit" className={styles.btnPrimary} disabled={pending}>
              {pending ? billing.checkout.payingButton : billing.checkout.payButton}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

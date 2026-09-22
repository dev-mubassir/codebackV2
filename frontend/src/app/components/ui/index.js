'use client';

/**
 * The product's UI primitives.
 *
 * Every internal page composes these and nothing else. A page that needs a
 * button, an input, a badge or a card imports it from here rather than writing
 * its own — which is how the last redesign ended up with four button styles and
 * a different card on every screen.
 *
 * Styling rules these enforce, so pages cannot break them:
 *   - colour, radius, border and shadow come from --ui-* tokens only
 *   - one accent; status colour is reachable only through <Badge tone>
 *   - a shadow exists only on Modal and Popover
 */

import { useCallback, useEffect, useId, useRef } from 'react';
import Icon from '@/app/components/Icon';
import s from './ui.module.css';

const cx = (...parts) => parts.filter(Boolean).join(' ');

/* ============================== Button ============================== */

const BTN_VARIANT = {
  primary: s.btnPrimary,
  secondary: s.btnSecondary,
  ghost: s.btnGhost,
  danger: s.btnDanger,
};

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  iconOnly = false,
  loading = false,
  disabled = false,
  className,
  children,
  ...rest
}) {
  return (
    <button
      type="button"
      className={cx(
        s.btn,
        BTN_VARIANT[variant] || BTN_VARIANT.secondary,
        size === 'sm' ? s.btnSm : s.btnMd,
        iconOnly && s.btnIconOnly,
        block && s.btnBlock,
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ====================== Field / Input / Select ====================== */

/**
 * Wraps any control with its label, hint and error, and wires the ids so the
 * label actually points at the control and the error is announced.
 */
export function Field({ label, hint, error, htmlFor, children, className }) {
  return (
    <div className={cx(s.field, className)}>
      {label && <label className={s.label} htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && !error && <span className={s.hint}>{hint}</span>}
      {error && <span className={s.fieldError} role="alert">{error}</span>}
    </div>
  );
}

export function Input({ label, hint, error, className, id, ...rest }) {
  const auto = useId();
  const inputId = id || auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <input
        id={inputId}
        className={cx(s.control, error && s.controlInvalid, className)}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Field>
  );
}

export function Textarea({ label, hint, error, className, id, ...rest }) {
  const auto = useId();
  const inputId = id || auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <textarea
        id={inputId}
        className={cx(s.control, s.textarea, error && s.controlInvalid, className)}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Field>
  );
}

export function Select({ label, hint, error, className, id, children, ...rest }) {
  const auto = useId();
  const inputId = id || auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <span className={s.selectWrap}>
        <select
          id={inputId}
          className={cx(s.control, s.select, error && s.controlInvalid, className)}
          aria-invalid={error ? true : undefined}
          {...rest}
        >
          {children}
        </select>
        <span className={s.selectChevron} aria-hidden="true">
          <Icon name="chevronDown" size={14} />
        </span>
      </span>
    </Field>
  );
}

/* =============================== Badge =============================== */

const BADGE_TONE = {
  neutral: s.badgeNeutral,
  accent: s.badgeAccent,
  positive: s.badgeSuccess,
  success: s.badgeSuccess,
  warning: s.badgeWarning,
  danger: s.badgeDanger,
};

/**
 * The only place status colour is applied.
 *
 * `tone` takes the values content/labels.js already emits — positive, neutral,
 * warning, danger — so a badge is `{...categoryLabel(x)}` with no mapping table
 * in the page.
 *
 * NOTE ON SPAM: spam and scam come through as tone "warning"/"danger" from
 * labels.js, but callers pass tone="neutral" for spam deliberately. Warning is
 * reserved for things the user must act on — a token about to expire, a reply
 * window about to close. Spam is a fact about a message, not a task.
 */
export function Badge({ tone = 'neutral', size = 'md', dot = false, children, className }) {
  return (
    <span className={cx(s.badge, BADGE_TONE[tone] || s.badgeNeutral, size === 'sm' ? s.badgeSm : s.badgeMd, className)}>
      {dot && <span className={s.badgeDot} aria-hidden="true" />}
      {children}
    </span>
  );
}

/* =============================== Card =============================== */

export function Card({ title, description, actions, flush = false, bareHeader = false, children, className, ...rest }) {
  return (
    <section className={cx(s.card, className)} {...rest}>
      {(title || actions) && (
        <header className={cx(s.cardHeader, bareHeader && s.cardHeaderBare)}>
          <div>
            {title && <h2 className={s.cardTitle}>{title}</h2>}
            {description && <p className={s.cardDescription}>{description}</p>}
          </div>
          {actions && <div className={s.cardActions}>{actions}</div>}
        </header>
      )}
      <div className={cx(s.cardBody, flush && s.cardBodyFlush)}>{children}</div>
    </section>
  );
}

/* ===================== EmptyState / ErrorState ====================== */

export function EmptyState({ icon, title, body, action }) {
  return (
    <div className={s.state}>
      {icon && <span className={s.stateIcon}><Icon name={icon} size={28} strokeWidth={1.5} /></span>}
      {title && <h3 className={s.stateTitle}>{title}</h3>}
      {body && <p className={s.stateBody}>{body}</p>}
      {action && <div className={s.stateAction}>{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, retryLabel = 'Try again' }) {
  return (
    <div className={s.state} role="alert">
      <span className={s.stateIcon}><Icon name="alertTriangle" size={28} strokeWidth={1.5} /></span>
      <p className={s.stateBody}>{message}</p>
      {onRetry && (
        <div className={s.stateAction}>
          <Button size="sm" onClick={onRetry}>{retryLabel}</Button>
        </div>
      )}
    </div>
  );
}

/* ============================= Skeleton ============================= */

export function Skeleton({ lines = 1, height = 14, width = '100%' }) {
  if (lines === 1) {
    return <span className={s.skeleton} style={{ display: 'block', height, width }} aria-hidden="true" />;
  }
  return (
    <div className={s.skeletonStack} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className={s.skeleton}
          style={{ display: 'block', height, width: i === lines - 1 ? '60%' : width }}
        />
      ))}
    </div>
  );
}

/* =============================== Tabs =============================== */

export function Tabs({ items, value, onChange, ariaLabel }) {
  return (
    <div className={s.tabs} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          className={cx(s.tab, value === item.id && s.tabActive)}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {typeof item.count === 'number' && <span className={s.tabCount}>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ============================== Toggle ============================== */

export function Toggle({ checked, onChange, label, disabled = false, id }) {
  const auto = useId();
  const inputId = id || auto;
  return (
    <label className={cx(s.toggleRow, disabled && s.toggleRowDisabled)} htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        role="switch"
        className={s.toggleInput}
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={s.toggleTrack} aria-hidden="true">
        <span className={s.toggleThumb} />
      </span>
      {label && <span className={s.toggleLabel}>{label}</span>}
    </label>
  );
}

/* =============================== Modal ============================== */

/**
 * Esc closes, focus moves inside on open and returns to the trigger on close,
 * and Tab is trapped. Without the trap a keyboard user tabs straight out of a
 * confirmation dialog and onto the page behind it.
 */
export function Modal({ title, onClose, actions, children, labelledBy }) {
  const ref = useRef(null);
  const previouslyFocused = useRef(null);
  const titleId = useId();

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    const node = ref.current;
    const focusable = node?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab' || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div className={s.modalOverlay} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={ref}
        className={s.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || titleId}
      >
        <header className={s.modalHeader}>
          <h2 className={s.modalTitle} id={titleId}>{title}</h2>
          <Button variant="ghost" size="sm" iconOnly onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </Button>
        </header>
        <div className={s.modalBody}>{children}</div>
        {actions && <div className={s.modalActions}>{actions}</div>}
      </div>
    </div>
  );
}

/* ============================== Popover ============================= */

export function Popover({ open, onClose, align = 'right', children, trigger }) {
  const ref = useRef(null);

  const handleAway = useCallback((e) => {
    if (ref.current && !ref.current.contains(e.target)) onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('mousedown', handleAway);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handleAway);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, handleAway, onClose]);

  return (
    <span className={s.popoverAnchor} ref={ref}>
      {trigger}
      {open && (
        <div className={cx(s.popover, align === 'left' && s.popoverLeft)} role="menu">
          {children}
        </div>
      )}
    </span>
  );
}

export function PopoverItem({ danger = false, children, ...rest }) {
  return (
    <button type="button" role="menuitem" className={cx(s.popoverItem, danger && s.popoverItemDanger)} {...rest}>
      {children}
    </button>
  );
}

/* ============================== IconTile ============================ */

const TILE_TONES = new Set(['accent', 'success', 'warning', 'danger', 'neutral']);

/**
 * A 32px tinted square holding one icon.
 *
 * Deliberately NOT general purpose. It exists for two places — inbox folder
 * rows and section headings — and `tone` must be a fact about the thing it
 * labels, never a way to make a row look livelier. An unrecognised tone falls
 * back to neutral rather than throwing, because a wrong colour is a wrong
 * claim and grey is the only safe claim to make.
 */
export function IconTile({ name, tone = 'neutral', size = 16, className = '' }) {
  if (!name) return null;
  const key = TILE_TONES.has(tone) ? tone : 'neutral';
  return (
    <span className={`${s.tile} ${s[`tile_${key}`]} ${className}`} aria-hidden="true">
      <Icon name={name} size={size} />
    </span>
  );
}

/* =============================== Meter ============================== */

/**
 * Renders nothing when the value is not a number.
 *
 * That is the whole point: the rejected design showed "85/100" from a `?? 85`
 * fallback whenever the AI had not scored a conversation. A meter with no score
 * is not a meter at zero, it is absent.
 */
export function Meter({ label, value, max = 100 }) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={s.meter}>
      <div className={s.meterHead}>
        <span className={s.meterLabel}>{label}</span>
        <span className={s.meterValue}>{value}/{max}</span>
      </div>
      <div
        className={s.meterTrack}
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <span className={s.meterFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ============================ PageHeader ============================ */

export function PageHeader({ title, description, actions }) {
  return (
    <div className={s.pageHeader}>
      <div>
        <h1 className={s.pageTitle}>{title}</h1>
        {description && <p className={s.pageDescription}>{description}</p>}
      </div>
      {actions && <div className={s.pageActions}>{actions}</div>}
    </div>
  );
}

export const srOnly = s.srOnly;
export { default as Avatar } from '@/app/components/Avatar';

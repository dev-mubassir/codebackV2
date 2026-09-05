'use client';

import { useId, useState } from 'react';
import Icon from '@/app/components/Icon';

/**
 * A password field with a show/hide toggle.
 *
 * Shared rather than copy-pasted: there are nine password inputs across five
 * pages, and a per-page implementation would drift — most likely in the
 * accessibility details, which are the part that actually matters here.
 *
 * Behaviour:
 *   - defaults to HIDDEN; revealing is always an explicit act
 *   - the toggle is a real <button type="button">, so it is keyboard
 *     reachable and cannot submit the form by accident
 *   - aria-label CHANGES with state ("Show password" / "Hide password"), so a
 *     screen reader user knows what the control will do, not just that it
 *     exists
 *   - aria-pressed conveys the current state
 *   - the icon is aria-hidden; the button's label carries the meaning
 *
 * Passes through every other prop, so callers keep their own id, name,
 * autoComplete, required, minLength and handlers unchanged.
 */
export default function PasswordInput({
  id,
  className = 'input',
  wrapperStyle,
  ...props
}) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <div style={{ position: 'relative', display: 'block', ...wrapperStyle }}>
      <input
        {...props}
        id={inputId}
        type={visible ? 'text' : 'password'}
        className={className}
        // Leave room for the toggle so a long value never runs underneath it.
        style={{ paddingRight: 42, ...(props.style || {}) }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        aria-controls={inputId}
        title={visible ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute',
          right: 6,
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          padding: 0,
          border: 'none',
          borderRadius: 6,
          background: 'transparent',
          cursor: 'pointer',
          color: 'var(--text-tertiary, #6b7280)',
          lineHeight: 0,
        }}
      >
        <span aria-hidden="true">
          <Icon name={visible ? 'eyeOff' : 'eye'} size={16} />
        </span>
      </button>
    </div>
  );
}

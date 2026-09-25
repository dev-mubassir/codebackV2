'use client';

/**
 * Confirm-with-a-reason. Every admin action that changes a customer's state
 * needs a written reason (3–500 characters); the backend refuses it without
 * one and stores it in the audit log. The confirm button stays disabled until
 * the reason is long enough, so the admin never meets that 400.
 */

import { useState } from 'react';
import { Button, Modal, Textarea } from '@/app/components/ui';
import { admin as t, common } from '@/content/copy';
import styles from '../admin.module.css';

export default function ReasonDialog({ title, who, body, actionLabel, variant = 'primary', busy, error, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const ready = reason.trim().length >= 3 && reason.trim().length <= 500;

  function submit(e) {
    e.preventDefault();
    if (ready && !busy) onConfirm(reason.trim());
  }

  return (
    <Modal
      title={title}
      onClose={busy ? undefined : onClose}
      actions={(
        <>
          <Button size="sm" onClick={onClose} disabled={busy}>{common.cancel}</Button>
          <Button size="sm" variant={variant} type="submit" form="admin-reason-form" loading={busy} disabled={!ready}>
            {actionLabel}
          </Button>
        </>
      )}
    >
      <form id="admin-reason-form" onSubmit={submit} className={styles.dialogForm}>
        {who && <p className={styles.dialogWho}>{who}</p>}
        {body && <p className={styles.dialogBody}>{body}</p>}
        <Textarea
          label={t.reason.label}
          hint={t.reason.hint}
          placeholder={t.reason.placeholder}
          value={reason}
          maxLength={500}
          rows={3}
          onChange={(e) => setReason(e.target.value)}
          required
        />
        {error && (
          <p className={`${styles.notice} ${styles.noticeError} ${styles.dialogError}`} role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

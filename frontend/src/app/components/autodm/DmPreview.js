'use client';

/**
 * Live preview of the conversation the automation will produce, built only
 * from what the user has typed — no sample names, no invented replies. All
 * text renders as text (React escapes it); nothing is interpreted as HTML.
 */

import { autodm } from './copy';
import s from './autodm.module.css';

const t = autodm.wizard.message;

function Placeholder({ children }) {
  return <span className={s.previewPlaceholder}>{children}</span>;
}

export default function DmPreview({ form, imageSrc }) {
  const opener = form.openerText.trim();
  const main = form.mainText.trim();
  const buttonLabel = form.openerButtonLabel.trim() || 'Send me the link';

  return (
    <aside className={s.preview} aria-label={t.preview}>
      <h2 className={s.previewTitle}>{t.preview}</h2>
      <div className={s.thread}>
        <div className={`${s.bubble} ${s.bubbleThem}`}>
          {opener || <Placeholder>{t.openerLabel}</Placeholder>}
          <span className={s.bubbleButton}>{buttonLabel}</span>
        </div>

        <div className={`${s.bubble} ${s.bubbleMe}`}>{buttonLabel}</div>

        {form.followGateEnabled && (
          <div className={`${s.bubble} ${s.bubbleThem}`}>
            {form.followPromptText.trim() || <Placeholder>{autodm.wizard.options.followPrompt}</Placeholder>}
            <span className={s.bubbleButton}>{form.followButtonLabel.trim() || "I've followed"}</span>
          </div>
        )}

        {imageSrc && (
          // A local preview (object URL) or our own public image URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageSrc} alt="" className={s.bubbleImage} />
        )}

        <div className={`${s.bubble} ${s.bubbleThem}`}>
          {main || <Placeholder>{t.mainLabel}</Placeholder>}
          {form.linkUrl.trim() && (
            <span className={s.bubbleButton}>{form.linkLabel.trim() || 'Open link'}</span>
          )}
        </div>
      </div>
      <p className={s.previewNote}>
        On a computer the button is hidden; typing {form.fallbackKeyword.trim() || 'LINK'} works instead.
      </p>
    </aside>
  );
}

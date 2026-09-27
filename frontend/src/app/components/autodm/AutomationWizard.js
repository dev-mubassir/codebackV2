'use client';

/**
 * The 4-step Auto DM builder: Post → Trigger → Message → Options, with a live
 * DM preview beside it. Used for both "new" and "edit".
 *
 * Client-side checks mirror the server's (backend/src/features/autodm/
 * validation.js) so mistakes show next to the field; the server is still the
 * authority and its message is shown if it refuses.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Textarea, Toggle, ErrorState, Skeleton } from '@/app/components/ui';
import { BACKEND_URL } from '@/lib/backendUrl';
import {
  createAutomation,
  updateAutomation,
  getAutoDmMedia,
  uploadAutoDmImage,
  autoDmImageUrl,
  apiErrorMessage,
} from '@/lib/autodmApi';
import DmPreview from './DmPreview';
import { autodm } from './copy';
import s from './autodm.module.css';

const t = autodm.wizard;
const TEMPLATE_MAX = 640;
const PLAIN_MAX = 900;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const defaultOpener = (k) =>
  `Thanks for your comment! Tap the button below and I'll send you the link. On a computer? Just reply ${k}.`;
const defaultFollowPrompt = (k) =>
  `Almost there! Follow this account first, then tap the button below (or reply ${k}) and the link is yours.`;

function blankForm() {
  return {
    name: '',
    postScope: 'ANY',
    mediaIds: [],
    triggerType: 'KEYWORDS',
    keywordsText: '',
    excludeText: '',
    openerText: defaultOpener('LINK'),
    openerButtonLabel: 'Send me the link',
    fallbackKeyword: 'LINK',
    mainText: '',
    imageId: null,
    linkUrl: '',
    linkLabel: '',
    followGateEnabled: false,
    followPromptText: defaultFollowPrompt('LINK'),
    followButtonLabel: "I've followed",
    followFailText: '',
    publicReplyEnabled: false,
    publicReplies: [''],
  };
}

function fromAutomation(a) {
  return {
    ...blankForm(),
    name: a.name,
    postScope: a.postScope,
    mediaIds: a.mediaIds || [],
    triggerType: a.triggerType,
    keywordsText: (a.keywords || []).join(', '),
    excludeText: (a.excludeKeywords || []).join(', '),
    openerText: a.openerText,
    openerButtonLabel: a.openerButtonLabel,
    fallbackKeyword: a.fallbackKeyword,
    mainText: a.mainText,
    imageId: a.imageId || null,
    linkUrl: a.linkUrl || '',
    linkLabel: a.linkLabel || '',
    followGateEnabled: a.followGateEnabled,
    followPromptText: a.followPromptText || defaultFollowPrompt(a.fallbackKeyword),
    followButtonLabel: a.followButtonLabel || "I've followed",
    followFailText: a.followFailText || '',
    publicReplyEnabled: a.publicReplyEnabled,
    publicReplies: a.publicReplies && a.publicReplies.length ? a.publicReplies : [''],
  };
}

const splitList = (text) =>
  Array.from(new Set(String(text || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean)));

const byteLength = (str) => new TextEncoder().encode(str).length;

function isHttpsUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname.includes('.');
  } catch {
    return false;
  }
}

function toBody(form, accountId, status) {
  const orNull = (v) => (v && v.trim() ? v.trim() : null);
  return {
    instagramAccountId: accountId,
    name: form.name.trim(),
    status,
    postScope: form.postScope,
    mediaIds: form.postScope === 'SPECIFIC' ? form.mediaIds : [],
    triggerType: form.triggerType,
    keywords: form.triggerType === 'KEYWORDS' ? splitList(form.keywordsText) : [],
    excludeKeywords: splitList(form.excludeText),
    publicReplyEnabled: form.publicReplyEnabled,
    publicReplies: form.publicReplyEnabled ? form.publicReplies.map((r) => r.trim()).filter(Boolean) : [],
    openerText: form.openerText.trim(),
    openerButtonLabel: form.openerButtonLabel.trim() || 'Send me the link',
    fallbackKeyword: form.fallbackKeyword.trim() || 'LINK',
    mainText: form.mainText.trim(),
    imageId: form.imageId || null,
    linkUrl: orNull(form.linkUrl),
    linkLabel: form.linkUrl.trim() ? orNull(form.linkLabel) : null,
    followGateEnabled: form.followGateEnabled,
    followPromptText: form.followGateEnabled ? orNull(form.followPromptText) : null,
    followButtonLabel: form.followGateEnabled ? orNull(form.followButtonLabel) : null,
    followFailText: form.followGateEnabled ? orNull(form.followFailText) : null,
  };
}

function validateStep(step, form) {
  const e = {};
  const tooLong = (v, n) => v.trim().length > n || byteLength(v.trim()) > 1000;
  if (step === 0) {
    if (!form.name.trim()) e.name = t.errors.name;
    else if (form.name.trim().length > 60) e.name = t.errors.tooLong(60);
    if (form.postScope === 'SPECIFIC' && form.mediaIds.length === 0) e.mediaIds = t.errors.posts;
  }
  if (step === 1) {
    const kws = splitList(form.keywordsText);
    if (form.triggerType === 'KEYWORDS' && kws.length === 0) e.keywords = t.errors.keywords;
    if (kws.length > 30 || kws.some((k) => k.length > 50)) e.keywords = 'Use at most 30 keywords of up to 50 characters.';
    const ex = splitList(form.excludeText);
    if (ex.length > 30 || ex.some((k) => k.length > 50)) e.exclude = 'Use at most 30 words of up to 50 characters.';
  }
  if (step === 2) {
    if (!form.openerText.trim()) e.openerText = t.errors.opener;
    else if (tooLong(form.openerText, TEMPLATE_MAX)) e.openerText = t.errors.tooLong(TEMPLATE_MAX);
    const mainMax = form.linkUrl.trim() ? TEMPLATE_MAX : PLAIN_MAX;
    if (!form.mainText.trim()) e.mainText = t.errors.main;
    else if (tooLong(form.mainText, mainMax)) e.mainText = t.errors.tooLong(mainMax);
    if (form.openerButtonLabel.trim().length > 20) e.openerButtonLabel = t.errors.tooLong(20);
    if (!form.fallbackKeyword.trim() || form.fallbackKeyword.trim().length > 20) e.fallbackKeyword = t.errors.tooLong(20);
    if (form.linkUrl.trim() && !isHttpsUrl(form.linkUrl.trim())) e.linkUrl = t.errors.link;
    if (form.linkUrl.trim() && !form.linkLabel.trim()) e.linkLabel = t.errors.linkLabel;
    if (form.linkLabel.trim().length > 20) e.linkLabel = t.errors.tooLong(20);
  }
  if (step === 3) {
    if (form.followGateEnabled) {
      if (tooLong(form.followPromptText, TEMPLATE_MAX)) e.followPromptText = t.errors.tooLong(TEMPLATE_MAX);
      if (form.followButtonLabel.trim().length > 20) e.followButtonLabel = t.errors.tooLong(20);
      if (tooLong(form.followFailText, PLAIN_MAX)) e.followFailText = t.errors.tooLong(PLAIN_MAX);
    }
    if (form.publicReplyEnabled) {
      const replies = form.publicReplies.map((r) => r.trim()).filter(Boolean);
      if (replies.length === 0) e.publicReplies = t.errors.publicReplies;
      if (replies.some((r) => r.length > 300)) e.publicReplies = t.errors.tooLong(300);
    }
  }
  return e;
}

function Counter({ value, max }) {
  const n = value.trim().length;
  return <div className={`${s.counter} ${n > max ? s.counterOver : ''}`}>{n}/{max}</div>;
}

function Choice({ name, checked, onChange, title, hint }) {
  return (
    <label className={`${s.choice} ${checked ? s.choiceSelected : ''}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span className={s.choiceText}>
        <span className={s.choiceTitle}>{title}</span>
        {hint && <span className={s.choiceHint}>{hint}</span>}
      </span>
    </label>
  );
}

// ------------------------------- Step 1 -------------------------------

function PostStep({ form, set, errors, accountId }) {
  const [media, setMedia] = useState(null);
  const [mediaError, setMediaError] = useState('');

  // Retry: clearing the error lets the effect below fetch again.
  const loadMedia = () => {
    setMedia(null);
    setMediaError('');
  };

  useEffect(() => {
    if (form.postScope !== 'SPECIFIC' || media !== null || mediaError) return undefined;
    let cancelled = false;
    getAutoDmMedia(accountId)
      .then((list) => { if (!cancelled) setMedia(list); })
      .catch((err) => { if (!cancelled) setMediaError(apiErrorMessage(err, t.post.loadError)); });
    return () => { cancelled = true; };
  }, [form.postScope, media, mediaError, accountId]);

  const toggle = (id) =>
    set({ mediaIds: form.mediaIds.includes(id) ? form.mediaIds.filter((x) => x !== id) : [...form.mediaIds, id] });

  return (
    <div className={s.form}>
      <Input
        label={t.name}
        hint={t.nameHint}
        value={form.name}
        maxLength={60}
        onChange={(e) => set({ name: e.target.value })}
        error={errors.name}
      />
      <h2 className={s.sectionTitle}>{t.post.heading}</h2>
      <div className={s.choices} role="radiogroup">
        <Choice name="scope" checked={form.postScope === 'ANY'} onChange={() => set({ postScope: 'ANY' })} title={t.post.any} hint={t.post.anyHint} />
        <Choice name="scope" checked={form.postScope === 'SPECIFIC'} onChange={() => set({ postScope: 'SPECIFIC' })} title={t.post.specific} hint={t.post.specificHint} />
      </div>

      {form.postScope === 'SPECIFIC' && (
        <>
          {mediaError ? (
            <ErrorState message={mediaError} onRetry={loadMedia} />
          ) : media === null ? (
            <Skeleton lines={2} height={120} />
          ) : media.length === 0 ? (
            <p className={s.fieldHint}>{t.post.none}</p>
          ) : (
            <>
              <p className={s.fieldHint}>{t.post.selected(form.mediaIds.length)}</p>
              <div className={s.mediaGrid}>
                {media.map((m) => {
                  const selected = form.mediaIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`${s.mediaItem} ${selected ? s.mediaSelected : ''}`}
                      onClick={() => toggle(m.id)}
                      aria-pressed={selected}
                    >
                      {m.thumbnailUrl ? (
                        // Instagram's own CDN thumbnail of the user's post.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.thumbnailUrl} alt="" className={s.mediaThumb} loading="lazy" />
                      ) : (
                        <span className={s.mediaNoThumb}>{m.mediaType || 'Post'}</span>
                      )}
                      <span className={s.mediaCaption}>{m.caption || t.post.noCaption}</span>
                      <input type="checkbox" className={s.mediaCheck} checked={selected} readOnly tabIndex={-1} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {errors.mediaIds && <span className={s.fieldError} role="alert">{errors.mediaIds}</span>}
        </>
      )}
    </div>
  );
}

// ------------------------------- Step 2 -------------------------------

function TriggerStep({ form, set, errors }) {
  return (
    <div className={s.form}>
      <h2 className={s.sectionTitle}>{t.trigger.heading}</h2>
      <div className={s.choices} role="radiogroup">
        <Choice name="trigger" checked={form.triggerType === 'ANY_COMMENT'} onChange={() => set({ triggerType: 'ANY_COMMENT' })} title={t.trigger.any} hint={t.trigger.anyHint} />
        <Choice name="trigger" checked={form.triggerType === 'KEYWORDS'} onChange={() => set({ triggerType: 'KEYWORDS' })} title={t.trigger.keywords} hint={t.trigger.keywordsHint} />
      </div>
      {form.triggerType === 'KEYWORDS' && (
        <Input
          label={t.trigger.keywordsLabel}
          placeholder={t.trigger.keywordsPlaceholder}
          value={form.keywordsText}
          onChange={(e) => set({ keywordsText: e.target.value })}
          error={errors.keywords}
        />
      )}
      <Input
        label={t.trigger.exclude}
        hint={t.trigger.excludeHint}
        placeholder={t.trigger.excludePlaceholder}
        value={form.excludeText}
        onChange={(e) => set({ excludeText: e.target.value })}
        error={errors.exclude}
      />
    </div>
  );
}

// ------------------------------- Step 3 -------------------------------

function MessageStep({ form, set, errors, imageSrc, onImage, imageBusy, imageError }) {
  const fileRef = useRef(null);
  const mainMax = form.linkUrl.trim() ? TEMPLATE_MAX : PLAIN_MAX;

  return (
    <div className={s.form}>
      <h2 className={s.sectionTitle}>{t.message.heading}</h2>
      <Textarea
        label={t.message.openerLabel}
        hint={t.message.openerHint}
        rows={4}
        value={form.openerText}
        onChange={(e) => set({ openerText: e.target.value })}
        error={errors.openerText}
      />
      <Counter value={form.openerText} max={TEMPLATE_MAX} />
      <div className={s.twoCol}>
        <Input
          label={t.message.buttonLabel}
          maxLength={20}
          value={form.openerButtonLabel}
          onChange={(e) => set({ openerButtonLabel: e.target.value })}
          error={errors.openerButtonLabel}
        />
        <Input
          label={t.message.fallbackLabel}
          hint={t.message.fallbackHint}
          maxLength={20}
          value={form.fallbackKeyword}
          onChange={(e) => set({ fallbackKeyword: e.target.value })}
          error={errors.fallbackKeyword}
        />
      </div>

      <Textarea
        label={t.message.mainLabel}
        hint={t.message.mainHint}
        rows={4}
        value={form.mainText}
        onChange={(e) => set({ mainText: e.target.value })}
        error={errors.mainText}
      />
      <Counter value={form.mainText} max={mainMax} />

      <div>
        <span className={s.fieldLabel}>{t.message.image}</span>
        <div className={s.imageRow}>
          {imageSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageSrc} alt="" className={s.imageThumb} />
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            className={s.fileInput}
            onChange={(e) => {
              const file = e.target.files && e.target.files[0];
              e.target.value = '';
              if (file) onImage(file);
            }}
          />
          <Button size="sm" onClick={() => fileRef.current && fileRef.current.click()} loading={imageBusy}>
            {imageBusy ? t.message.imageUploading : t.message.imageChoose}
          </Button>
          {form.imageId && !imageBusy && (
            <Button size="sm" variant="ghost" onClick={() => onImage(null)}>
              {t.message.imageRemove}
            </Button>
          )}
        </div>
        {imageError ? (
          <span className={s.fieldError} role="alert">{imageError}</span>
        ) : (
          <span className={s.fieldHint}>{t.message.imageHint}</span>
        )}
      </div>

      <div className={s.twoCol}>
        <Input
          label={t.message.linkLabel}
          hint={t.message.linkHint}
          placeholder={t.message.linkPlaceholder}
          type="url"
          inputMode="url"
          value={form.linkUrl}
          onChange={(e) => set({ linkUrl: e.target.value })}
          error={errors.linkUrl}
        />
        <Input
          label={t.message.linkButtonLabel}
          maxLength={20}
          value={form.linkLabel}
          onChange={(e) => set({ linkLabel: e.target.value })}
          error={errors.linkLabel}
          disabled={!form.linkUrl.trim()}
        />
      </div>
    </div>
  );
}

// ------------------------------- Step 4 -------------------------------

function OptionsStep({ form, set, errors }) {
  const updateReply = (i, value) => set({ publicReplies: form.publicReplies.map((r, j) => (j === i ? value : r)) });
  return (
    <div className={s.form}>
      <h2 className={s.sectionTitle}>{t.options.heading}</h2>

      <Toggle checked={form.followGateEnabled} onChange={(v) => set({ followGateEnabled: v })} label={t.options.follow} />
      <span className={s.fieldHint}>{t.options.followHint}</span>
      {form.followGateEnabled && (
        <>
          <Textarea
            label={t.options.followPrompt}
            rows={3}
            value={form.followPromptText}
            onChange={(e) => set({ followPromptText: e.target.value })}
            error={errors.followPromptText}
          />
          <Counter value={form.followPromptText} max={TEMPLATE_MAX} />
          <Input
            label={t.options.followButton}
            maxLength={20}
            value={form.followButtonLabel}
            onChange={(e) => set({ followButtonLabel: e.target.value })}
            error={errors.followButtonLabel}
          />
          <Textarea
            label={t.options.followFail}
            rows={2}
            value={form.followFailText}
            onChange={(e) => set({ followFailText: e.target.value })}
            error={errors.followFailText}
          />
        </>
      )}

      <Toggle checked={form.publicReplyEnabled} onChange={(v) => set({ publicReplyEnabled: v })} label={t.options.publicReply} />
      <span className={s.fieldHint}>{t.options.publicReplyHint}</span>
      {form.publicReplyEnabled && (
        <>
          {form.publicReplies.map((reply, i) => (
            <div key={i} className={s.replyRow}>
              <Input
                label={t.options.publicReplyN(i + 1)}
                maxLength={300}
                value={reply}
                onChange={(e) => updateReply(i, e.target.value)}
              />
              {form.publicReplies.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => set({ publicReplies: form.publicReplies.filter((_, j) => j !== i) })}>
                  {t.options.removeReply}
                </Button>
              )}
            </div>
          ))}
          {form.publicReplies.length < 3 && (
            <div>
              <Button size="sm" onClick={() => set({ publicReplies: [...form.publicReplies, ''] })}>
                {t.options.addReply}
              </Button>
            </div>
          )}
          {errors.publicReplies && <span className={s.fieldError} role="alert">{errors.publicReplies}</span>}
        </>
      )}
    </div>
  );
}

// ------------------------------- Wizard -------------------------------

export default function AutomationWizard({ accountId, automation = null }) {
  const router = useRouter();
  const [form, setForm] = useState(() => (automation ? fromAutomation(automation) : blankForm()));
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(automation ? 3 : 0);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [localImage, setLocalImage] = useState(null); // object URL of a fresh upload
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');

  // Editing a field clears its own error; the rest wait for the next step check.
  const ERROR_KEY = { keywordsText: 'keywords', excludeText: 'exclude' };
  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[ERROR_KEY[k] || k];
      return next;
    });
  };

  useEffect(() => () => {
    if (localImage) URL.revokeObjectURL(localImage);
  }, [localImage]);

  const imageSrc = useMemo(() => {
    if (!form.imageId) return null;
    if (localImage) return localImage;
    return autoDmImageUrl(BACKEND_URL, form.imageId);
  }, [form.imageId, localImage]);

  async function onImage(file) {
    setImageError('');
    if (!file) {
      set({ imageId: null });
      setLocalImage(null);
      return;
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setImageError(t.message.imageWrongType);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(t.message.imageTooBig);
      return;
    }
    setImageBusy(true);
    try {
      const uploaded = await uploadAutoDmImage(file);
      set({ imageId: uploaded.id });
      setLocalImage(URL.createObjectURL(file));
    } catch (err) {
      setImageError(apiErrorMessage(err, t.message.imageError));
    } finally {
      setImageBusy(false);
    }
  }

  function go(next) {
    if (next > step) {
      const e = validateStep(step, form);
      setErrors(e);
      if (Object.keys(e).length) return;
    }
    setErrors({});
    setStep(next);
    setReached((r) => Math.max(r, next));
  }

  async function save() {
    for (let i = 0; i < 4; i += 1) {
      const e = validateStep(i, form);
      if (Object.keys(e).length) {
        setErrors(e);
        setStep(i);
        return;
      }
    }
    setSaving(true);
    setSaveError('');
    try {
      const body = toBody(form, accountId, automation ? undefined : 'active');
      if (automation) {
        body.status = automation.status;
        await updateAutomation(automation.id, body);
      } else {
        await createAutomation(body);
      }
      router.push(`/autodm?account=${encodeURIComponent(accountId)}`);
    } catch (err) {
      setSaveError(apiErrorMessage(err, t.saveError));
      setSaving(false);
    }
  }

  const StepBody = [PostStep, TriggerStep, MessageStep, OptionsStep][step];

  return (
    <div className={s.wizard}>
      <div>
        <ol className={s.steps} aria-label="Steps">
          {t.steps.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                className={`${s.step} ${i === step ? s.stepActive : ''} ${i < step ? s.stepDone : ''}`}
                aria-current={i === step ? 'step' : undefined}
                disabled={i > reached}
                onClick={() => go(i)}
              >
                <span className={s.stepNum}>{i + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>

        <div className={s.panel}>
          <StepBody
            form={form}
            set={set}
            errors={errors}
            accountId={accountId}
            imageSrc={imageSrc}
            onImage={onImage}
            imageBusy={imageBusy}
            imageError={imageError}
          />

          {saveError && <p className={`${s.errNote} ${s.saveErr}`} role="alert">{saveError}</p>}

          <div className={s.wizardFoot}>
            <Button variant="ghost" onClick={() => (step === 0 ? router.push('/autodm') : go(step - 1))}>
              {step === 0 ? t.cancel : t.back}
            </Button>
            <div className={s.wizardFootRight}>
              {step < 3 ? (
                <Button variant="primary" onClick={() => go(step + 1)}>{t.next}</Button>
              ) : (
                <Button variant="primary" onClick={save} loading={saving}>
                  {automation ? t.saveChanges : t.saveActivate}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <DmPreview form={form} imageSrc={imageSrc} />
    </div>
  );
}

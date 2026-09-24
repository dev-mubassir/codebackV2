'use client';

/**
 * The business-profile fields, defined once and rendered wherever they are asked for.
 *
 * WHY THIS EXISTS. Onboarding step 3 and the Settings business-profile tab ask
 * for the same things with the same labels, and master had two copies that had
 * already drifted apart. `locationDelivery` is what that drift looks like: the
 * starter templates fill it and BOTH screens post it on save, but NEITHER ever
 * rendered a field for it, so the text was stored and round-tripped without
 * anyone being able to read or correct it. One definition, one place to add the
 * tenth field.
 *
 * The two screens want overlapping but different subsets — Settings adds
 * `businessName` and `prohibitedTopics` and keeps tone with the reply settings,
 * onboarding does the opposite — so the caller passes `fields`. What it cannot
 * do is re-define what a field IS: the label, the control and the cap all live
 * here.
 *
 * Fully controlled and stateless. The parent owns `values` and gets every edit
 * through `onChange(name, value)`. Onboarding needs the whole object at once to
 * post it; Settings saves the profile as one object too. Neither can work if
 * this holds state of its own.
 */

import { Input, Textarea, Select } from './index';
import { settings as settingsCopy, common } from '@/content/copy';
import { TONE_ORDER, toneLabel } from '@/content/labels';
import s from './ui.module.css';

const bp = settingsCopy.businessProfile;
const replies = settingsCopy.replies;

/**
 * Every field, with the server's own cap from
 * backend/src/services/businessProfileService.js. The sanitiser silently
 * `slice()`s anything longer, so without `maxLength` a person types a
 * 2,500-character description, watches it save, and loses the tail with no
 * warning anywhere.
 */
const FIELD_DEFS = {
  businessName: { control: 'input', label: bp.nameLabel, placeholder: bp.namePlaceholder, max: 200 },
  description: { control: 'textarea', rows: 2, label: bp.descriptionLabel, placeholder: bp.descriptionPlaceholder, max: 2000 },
  productsServices: { control: 'textarea', rows: 3, label: bp.servicesLabel, placeholder: bp.servicesPlaceholder, max: 3000 },
  pricingInfo: { control: 'textarea', rows: 2, label: bp.pricingLabel, placeholder: bp.pricingPlaceholder, hint: bp.pricingHint, max: 1500 },
  locationDelivery: { control: 'input', label: bp.locationLabel, placeholder: bp.locationPlaceholder, hint: bp.locationHint, max: 1000 },
  policies: { control: 'textarea', rows: 2, label: bp.policiesLabel, placeholder: bp.policiesPlaceholder, max: 2000 },
  paymentMethods: { control: 'input', label: bp.paymentLabel, placeholder: bp.paymentPlaceholder, max: 1000 },
  faqData: { control: 'textarea', rows: 3, label: bp.faqLabel, placeholder: bp.faqPlaceholder, max: 4000 },
  prohibitedTopics: { control: 'textarea', rows: 2, label: bp.prohibitedLabel, placeholder: bp.prohibitedPlaceholder, hint: bp.prohibitedHint, max: 1500 },
  aiInstructions: { control: 'textarea', rows: 2, label: replies.instructionsLabel, placeholder: replies.instructionsPlaceholder, max: 2500 },
  tone: { control: 'tone', label: replies.toneLabel },
};

/** What onboarding asks for, and the order it asks in. */
export const ONBOARDING_FIELDS = [
  'description', 'productsServices', 'pricingInfo', 'locationDelivery',
  'policies', 'paymentMethods', 'faqData', 'aiInstructions', 'tone',
];

/** What Account shows, read-only. Enough to recognise the profile without
 *  restating all nine fields on a page whose job is the login, not the
 *  business. Editing happens in Settings, which the card links to. */
export const ACCOUNT_SUMMARY_FIELDS = [
  'businessName', 'description', 'productsServices', 'pricingInfo', 'locationDelivery',
];

/** What the Settings business-profile tab asks for. Tone and instructions live
 *  with the reply settings there, and `locationDelivery` is new — master saved
 *  it without ever showing it. */
export const SETTINGS_PROFILE_FIELDS = [
  'businessName', 'description', 'productsServices', 'pricingInfo',
  'locationDelivery', 'policies', 'paymentMethods', 'faqData', 'prohibitedTopics',
];

/** name -> server cap, for anyone who needs the numbers without the markup. */
export const BUSINESS_PROFILE_LIMITS = Object.fromEntries(
  Object.entries(FIELD_DEFS).filter(([, d]) => d.max).map(([k, d]) => [k, d.max]),
);

/**
 * @param {boolean} [readOnly]  Render each field as a label and its stored
 *   value instead of a control. Account needs to SHOW this profile, and a
 *   fourth hand-written rendering of the same nine labels is how the first
 *   three drifted apart.
 */
export default function BusinessProfileFields({
  values,
  onChange,
  disabled = false,
  fields = ONBOARDING_FIELDS,
  readOnly = false,
}) {
  return (
    <>
      {fields.map((name) => {
        const def = FIELD_DEFS[name];
        if (!def) return null;

        if (readOnly) {
          const raw = name === 'tone'
            ? toneLabel(values.tone || 'friendly').label
            : values[name];
          const text = typeof raw === 'string' ? raw.trim() : '';
          return (
            <div key={name} className={s.readField}>
              <span className={s.readLabel}>{def.label}</span>
              <p className={s.readValue}>{text || common.notConfigured}</p>
            </div>
          );
        }

        // `key` stays an explicit prop on each element rather than riding in
        // this object: React reads it fine either way, but the lint rule is
        // static and a spread key silently disables the check for everyone.
        const shared = {
          label: def.label,
          hint: def.hint,
          disabled,
        };

        if (def.control === 'tone') {
          return (
            /* `custom` is a stored value, not something to pick: it means the
               tone came from free text elsewhere, so offering it here would set
               a mode with nothing behind it. */
            <Select
              key={name}
              {...shared}
              value={values.tone || 'friendly'}
              onChange={(e) => onChange('tone', e.target.value)}
            >
              {TONE_ORDER.filter((v) => v !== 'custom').map((value) => (
                <option key={value} value={value}>
                  {toneLabel(value).label} — {toneLabel(value).description}
                </option>
              ))}
            </Select>
          );
        }

        const control = {
          ...shared,
          placeholder: def.placeholder,
          maxLength: def.max,
          value: values[name] ?? '',
          onChange: (e) => onChange(name, e.target.value),
        };

        return def.control === 'input'
          ? <Input key={name} {...control} />
          : <Textarea key={name} {...control} rows={def.rows} />;
      })}
    </>
  );
}

'use client';

/**
 * The nine business-profile fields, in one place.
 *
 * WHY THIS EXISTS. Onboarding step 3 and the Settings business-profile panel
 * ask for the same nine things with the same labels — master had two copies,
 * drifting. The `locationDelivery` bug is what that drift looks like: the
 * starter templates filled it and the save posted it, but only one of the two
 * screens ever rendered a field for it, so the user stored text they had never
 * seen. One component, one list of fields, one place to add the tenth.
 *
 * Fully controlled and stateless: the parent owns `values` and gets every edit
 * through `onChange(name, value)`. Onboarding needs the whole object at once to
 * post it, and Settings saves field by field; neither can work if this holds
 * state of its own.
 *
 * `maxLength` on each control mirrors the server's caps in
 * backend/src/services/businessProfileService.js — the sanitiser silently
 * `slice()`s anything longer, so without these the user types a 2,500-character
 * description, sees it accepted, and loses the tail with no warning.
 */

import { Input, Textarea, Select } from './index';
import { settings as settingsCopy } from '@/content/copy';
import { TONE_ORDER, toneLabel } from '@/content/labels';

const bp = settingsCopy.businessProfile;
const replies = settingsCopy.replies;

/** name -> server cap. Kept beside the fields so the two cannot drift apart. */
export const BUSINESS_PROFILE_LIMITS = {
  description: 2000,
  productsServices: 3000,
  pricingInfo: 1500,
  locationDelivery: 1000,
  policies: 2000,
  paymentMethods: 1000,
  faqData: 4000,
  aiInstructions: 2500,
};

/** Every field this component owns, so a caller can build a payload from one list. */
export const BUSINESS_PROFILE_FIELDS = [
  ...Object.keys(BUSINESS_PROFILE_LIMITS),
  'tone',
];

export default function BusinessProfileFields({ values, onChange, disabled = false }) {
  const field = (name) => ({
    value: values[name] ?? '',
    disabled,
    maxLength: BUSINESS_PROFILE_LIMITS[name],
    onChange: (e) => onChange(name, e.target.value),
  });

  return (
    <>
      <Textarea
        label={bp.descriptionLabel}
        placeholder={bp.descriptionPlaceholder}
        rows={2}
        {...field('description')}
      />

      <Textarea
        label={bp.servicesLabel}
        placeholder={bp.servicesPlaceholder}
        rows={3}
        {...field('productsServices')}
      />

      <Textarea
        label={bp.pricingLabel}
        placeholder={bp.pricingPlaceholder}
        hint={bp.pricingHint}
        rows={2}
        {...field('pricingInfo')}
      />

      <Input
        label={bp.locationLabel}
        placeholder={bp.locationPlaceholder}
        hint={bp.locationHint}
        {...field('locationDelivery')}
      />

      <Textarea
        label={bp.policiesLabel}
        placeholder={bp.policiesPlaceholder}
        rows={2}
        {...field('policies')}
      />

      <Input
        label={bp.paymentLabel}
        placeholder={bp.paymentPlaceholder}
        {...field('paymentMethods')}
      />

      <Textarea
        label={bp.faqLabel}
        placeholder={bp.faqPlaceholder}
        rows={3}
        {...field('faqData')}
      />

      <Textarea
        label={replies.instructionsLabel}
        placeholder={replies.instructionsPlaceholder}
        rows={2}
        {...field('aiInstructions')}
      />

      {/* `custom` is a stored value, not something to pick: it means the tone
          came from free text elsewhere, so offering it here would set a mode
          with nothing behind it. */}
      <Select
        label={settingsCopy.replies.toneLabel}
        value={values.tone || 'friendly'}
        disabled={disabled}
        onChange={(e) => onChange('tone', e.target.value)}
      >
        {TONE_ORDER.filter((v) => v !== 'custom').map((value) => (
          <option key={value} value={value}>
            {toneLabel(value).label} — {toneLabel(value).description}
          </option>
        ))}
      </Select>
    </>
  );
}

/**
 * Everything the hero mockup says, in one place.
 *
 * Gate 2 adds the animation timeline to this file. Keeping the copy and the
 * timings together is the point: a message and the moment it appears are one
 * editorial decision, and splitting them across two files is how they drift.
 *
 * EVERY HANDLE AND NAME HERE IS INVENTED. None of these are real Instagram
 * accounts and none of this is customer data. This is a product illustration
 * on a marketing page — if a handle below ever turns out to belong to a real
 * account, change it, do not keep it because it renders nicely.
 */

/**
 * The four label pills.
 *
 * `label` matches what the product actually displays in
 * frontend/src/content/labels.js — `lead` renders "Lead", `spam` renders
 * "Spam", and `brand_deal`/`collaboration` both render "Brand deal", which is
 * why the pill here says "Brand deal" and not "Collab".
 *
 * The colours are a hero-only mapping. The product derives pill colour from a
 * four-value `tone` (neutral | positive | warning | danger), under which both
 * Lead and Brand deal come out the same green. Two identical greens carry no
 * information in an animation whose whole job is to show sorting happening, so
 * the hero splits them: Question takes the info blue and Brand deal takes the
 * AI purple. Every pair below is an existing --color-*-subtle / --color-*-text
 * pair from the app, so each one is already AA-legible.
 */
export const LABELS = {
  lead: { id: 'lead', label: 'Lead', tone: 'success' },
  question: { id: 'question', label: 'Question', tone: 'info' },
  brand_deal: { id: 'brand_deal', label: 'Brand deal', tone: 'ai' },
  spam: { id: 'spam', label: 'Spam', tone: 'warning' },
};

/**
 * The inbox, in the order it settles into once sorted.
 *
 * `section` groups the rows under headings in the calm state. `spam: true`
 * marks the row Gate 2 collapses and removes — it is carried in the data
 * rather than hardcoded in the component so the sequence stays editable here.
 */
export const MESSAGES = [
  {
    id: 'm1',
    handle: '@priya.bakes',
    initials: 'PB',
    text: 'price kya hai?',
    time: '2m',
    label: 'lead',
    section: 'Leads',
  },
  {
    id: 'm2',
    handle: '@deepak.traders',
    initials: 'DT',
    text: 'wholesale rates?',
    time: '6m',
    label: 'lead',
    section: 'Leads',
  },
  {
    id: 'm3',
    handle: '@anaya.styles',
    initials: 'AS',
    text: 'is this available in size M?',
    time: '11m',
    label: 'question',
    section: 'Questions',
  },
  {
    id: 'm4',
    handle: '@rahul_fitness',
    initials: 'RF',
    text: 'do you ship to Pune?',
    time: '18m',
    label: 'question',
    section: 'Questions',
  },
  {
    id: 'm5',
    handle: '@kabir.m',
    initials: 'KM',
    text: 'hi',
    time: '24m',
    label: 'question',
    section: 'Questions',
  },
  {
    id: 'm6',
    handle: '@studio.marigold',
    initials: 'SM',
    text: 'collab? 🙌',
    time: '31m',
    label: 'brand_deal',
    section: 'Brand deals',
  },
  {
    id: 'm7',
    handle: '@free.followers.now',
    initials: 'FF',
    text: 'FREE FOLLOWERS click here',
    time: '33m',
    label: 'spam',
    section: null,
    spam: true,
  },
];

/** Section headings, in the order they stack in the calm state. */
export const SECTIONS = ['Leads', 'Questions', 'Brand deals'];

/** The auto-reply Gate 2 types out. Stated here so the copy is reviewable. */
export const AUTO_REPLY = {
  threadId: 'm1',
  body: "Hi! Our prices start at ₹499. Here's the catalogue 👇",
  tag: 'Auto-replied by Siffty',
};

/** The toast that closes the loop. */
export const TOAST = '3 new leads found today';

/** Unread badge value in the settled state. */
export const UNREAD_CALM = 0;

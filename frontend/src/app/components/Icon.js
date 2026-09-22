/**
 * Siffty Custom Icon System
 *
 * Supports the Framer Duotone & Rounded aesthetic (20% opacity tinted background fill + stroke overlay),
 * featuring the official Framer Home icon for Dashboard (https://framer.com/m/Home-CSxJou.js@YmjZFCBuyJdEW7cp59KM).
 *
 * Icons inherit `currentColor`, so color is set by the surrounding CSS.
 */

import React from 'react';

const ICONS = {
  // Navigation & Workspace (Custom Framer Duotone Icons)
  dashboard: {
    viewBox: '0 0 100 100',
    content: (
      <g fill="transparent" transform="translate(6 6)">
        <g opacity="0.18">
          <path
            d="M 0 38.203 C 0 31.389 3.232 24.939 8.8 20.624 L 28.8 5.135 C 37.642 -1.712 50.358 -1.712 59.2 5.135 L 79.2 20.624 C 84.768 24.939 88 31.389 88 38.203 L 88 65.289 C 88 77.832 77.255 88 64 88 L 24 88 C 10.745 88 0 77.832 0 65.289 Z"
            fill="currentColor"
          />
        </g>
        <path
          d="M 0 38.203 C 0 31.389 3.232 24.939 8.8 20.624 L 28.8 5.135 C 37.642 -1.712 50.358 -1.712 59.2 5.135 L 79.2 20.624 C 84.768 24.939 88 31.389 88 38.203 L 88 65.289 C 88 77.832 77.255 88 64 88 L 24 88 C 10.745 88 0 77.832 0 65.289 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M 0 23.889 L 0 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="13"
          strokeLinecap="round"
          strokeLinejoin="round"
          transform="translate(44 56.777)"
        />
      </g>
    ),
  },

  home: {
    viewBox: '0 0 100 100',
    content: (
      <g fill="transparent" transform="translate(6 6)">
        <g opacity="0.18">
          <path
            d="M 0 38.203 C 0 31.389 3.232 24.939 8.8 20.624 L 28.8 5.135 C 37.642 -1.712 50.358 -1.712 59.2 5.135 L 79.2 20.624 C 84.768 24.939 88 31.389 88 38.203 L 88 65.289 C 88 77.832 77.255 88 64 88 L 24 88 C 10.745 88 0 77.832 0 65.289 Z"
            fill="currentColor"
          />
        </g>
        <path
          d="M 0 38.203 C 0 31.389 3.232 24.939 8.8 20.624 L 28.8 5.135 C 37.642 -1.712 50.358 -1.712 59.2 5.135 L 79.2 20.624 C 84.768 24.939 88 31.389 88 38.203 L 88 65.289 C 88 77.832 77.255 88 64 88 L 24 88 C 10.745 88 0 77.832 0 65.289 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M 0 23.889 L 0 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="13"
          strokeLinecap="round"
          strokeLinejoin="round"
          transform="translate(44 56.777)"
        />
      </g>
    ),
  },

  inbox: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path
          d="M21 12.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.4-4.2-1.1L3 21l1.3-4.8A8.48 8.48 0 0 1 3.5 12.5 8.5 8.5 0 1 1 21 12.5z"
          fill="currentColor"
          opacity="0.18"
        />
        <path
          d="M21 12.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.4-4.2-1.1L3 21l1.3-4.8A8.48 8.48 0 0 1 3.5 12.5 8.5 8.5 0 1 1 21 12.5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="8" y1="11" x2="16" y2="11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="8" y1="15" x2="13" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },

  bell: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path
          d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
          fill="currentColor"
          opacity="0.18"
        />
        <path
          d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  settings: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.22" />
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },

  wallet: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <rect x="2" y="5" width="20" height="15" rx="3" fill="currentColor" opacity="0.18" />
        <rect x="2" y="5" width="20" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="2" y1="9" x2="22" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <rect x="5" y="13" width="4" height="3" rx="1" fill="currentColor" />
      </>
    ),
  },

  creditCard: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="3" fill="currentColor" opacity="0.18" />
        <rect x="2" y="5" width="20" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="2" y1="10" x2="22" y2="10" stroke="currentColor" strokeWidth="2" />
        <circle cx="7" cy="15" r="1.2" fill="currentColor" />
        <circle cx="11" cy="15" r="1.2" fill="currentColor" />
      </>
    ),
  },

  crown: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path
          d="M2 18h20v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2zm1.2-12.5l3.8 6.5 5-8 5 8 3.8-6.5L22 17H2l1.2-11.5z"
          fill="currentColor"
          opacity="0.2"
        />
        <path
          d="M2 18h20v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M3.2 5.5l3.8 6.5 5-8 5 8 3.8-6.5L22 17H2l1.2-11.5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="3.5" cy="5" r="1" fill="currentColor" />
        <circle cx="12" cy="3.5" r="1" fill="currentColor" />
        <circle cx="20.5" cy="5" r="1" fill="currentColor" />
      </>
    ),
  },

  // Metric & Intelligence Icons
  alertTriangle: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path
          d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
          fill="currentColor"
          opacity="0.18"
        />
        <path
          d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="12" cy="17" r="1.1" fill="currentColor" />
      </>
    ),
  },

  flame: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path
          d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
          fill="currentColor"
          opacity="0.2"
        />
        <path
          d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },

  handshake: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path
          d="m11 17 2 2a1 1 0 1 0 3-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M3 4h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },

  messageSquare: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path
          d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
          fill="currentColor"
          opacity="0.18"
        />
        <path
          d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="7" y1="8" x2="17" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="7" y1="12" x2="13" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },

  clock: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <circle cx="12" cy="12" r="9.5" fill="currentColor" opacity="0.18" />
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <polyline points="12 7 12 12 15.5 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  barChart: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <rect x="3" y="12" width="4" height="9" rx="1.5" fill="currentColor" opacity="0.25" />
        <rect x="3" y="12" width="4" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="10" y="4" width="4" height="17" rx="1.5" fill="currentColor" opacity="0.25" />
        <rect x="10" y="4" width="4" height="17" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="17" y="8" width="4" height="13" rx="1.5" fill="currentColor" opacity="0.25" />
        <rect x="17" y="8" width="4" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
      </>
    ),
  },

  target: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <circle cx="12" cy="12" r="9.5" fill="currentColor" opacity="0.18" />
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </>
    ),
  },

  briefcase: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <rect x="2" y="7" width="20" height="14" rx="3" fill="currentColor" opacity="0.18" />
        <rect x="2" y="7" width="20" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  tag: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path
          d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"
          fill="currentColor"
          opacity="0.18"
        />
        <path
          d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="7" cy="7" r="1.5" fill="currentColor" />
      </>
    ),
  },

  instagram: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <rect x="2" y="2" width="20" height="20" rx="5.5" fill="currentColor" opacity="0.16" />
        <rect x="2" y="2" width="20" height="20" rx="5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" />
      </>
    ),
  },

  // Category Badges & Secondary Icons
  user: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" fill="currentColor" opacity="0.18" />
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="7" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      </>
    ),
  },

  users: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" fill="currentColor" opacity="0.18" />
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="9" cy="7" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  headphones: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" fill="currentColor" opacity="0.18" />
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" fill="currentColor" />
      </>
    ),
  },

  ban: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <circle cx="12" cy="12" r="9.5" fill="currentColor" opacity="0.18" />
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <line x1="5.2" y1="5.2" x2="18.8" y2="18.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },

  shield: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="currentColor" opacity="0.2" />
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  shieldAlert: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="currentColor" opacity="0.2" />
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="16" r="1" fill="currentColor" />
      </>
    ),
  },

  logOut: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points="16 17 21 12 16 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  // Actions & Utilities
  calendar: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2.5" fill="currentColor" opacity="0.18" />
        <rect x="3" y="4" width="18" height="18" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },

  refresh: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <polyline points="23 4 23 10 17 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  arrowRight: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points="12 5 19 12 12 19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  arrowLeft: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <line x1="19" y1="12" x2="5" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points="12 19 5 12 12 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  chevronDown: {
    viewBox: '0 0 24 24',
    content: <polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  },

  chevronRight: {
    viewBox: '0 0 24 24',
    content: <polyline points="9 18 15 12 9 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  },

  // Added for the rebuilt internal pages: the mobile inbox's back control and
  // the per-conversation search in settings. Same 24x24 line style as the rest
  // of the utility icons in this set.
  chevronLeft: {
    viewBox: '0 0 24 24',
    content: <polyline points="15 18 9 12 15 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  },

  search: {
    viewBox: '0 0 24 24',
    content: (
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </g>
    ),
  },

  check: {
    viewBox: '0 0 24 24',
    content: <polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  },

  x: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  plus: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  zap: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" opacity="0.22" />
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  send: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <line x1="22" y1="2" x2="11" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" opacity="0.18" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  menu: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },

  // A "more actions" affordance, distinct from `menu` (which opens the mobile
  // nav drawer). Reusing `menu` for both read as "open navigation".
  moreHorizontal: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <circle cx="5" cy="12" r="1.6" fill="currentColor" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
        <circle cx="19" cy="12" r="1.6" fill="currentColor" />
      </>
    ),
  },

  // `eraser` and `externalLink` were referenced by the inbox before they
  // existed here. Icon returns null for an unknown name, so both rendered
  // nothing at all — silently, with no console warning.
  eraser: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path d="M13 4.5 4.5 13a2 2 0 0 0 0 2.8l3.7 3.7h5l7.3-7.3a2 2 0 0 0 0-2.8l-4.7-4.9a2 2 0 0 0-2.8 0Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="9" y1="19.5" x2="20" y2="19.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="10" y1="7.5" x2="16.5" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },

  externalLink: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points="15 3 21 3 21 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },

  copy: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <rect x="9" y="9" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  trash: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <polyline points="3 6 5 6 21 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  lock: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" fill="currentColor" opacity="0.18" />
        <rect x="3" y="11" width="18" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },

  helpCircle: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <circle cx="12" cy="12" r="9.5" fill="currentColor" opacity="0.18" />
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="17" r="1.1" fill="currentColor" />
      </>
    ),
  },

  sparkle: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 8.5 13.5 12 12 15.5 10.5 12z" fill="currentColor" opacity="0.25" />
        <path d="M12 8.5 13.5 12 12 15.5 10.5 12z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </>
    ),
  },

  eye: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" fill="currentColor" opacity="0.18" />
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
      </>
    ),
  },

  eyeOff: {
    viewBox: '0 0 24 24',
    content: (
      <>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
};

export const ICON_NAMES = Object.keys(ICONS);

export default function Icon({ name, size = 18, strokeWidth = 2, title, className, style }) {
  const iconDef = ICONS[name];
  if (!iconDef) return null;

  const viewBox = iconDef.viewBox || '0 0 24 24';
  const content = iconDef.content || iconDef;

  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox={viewBox}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      aria-label={title || undefined}
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      {content}
    </svg>
  );
}

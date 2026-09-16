import './globals.css';

/**
 * Root layout for the marketing site on the apex domain (siffty.com).
 *
 * Kept deliberately close to frontend/src/app/layout.js so the two read as one
 * product, but the metadata is written for a page that gets shared and indexed
 * rather than logged into. The copy is a local constant, not an import from
 * frontend/src/content/copy.js — this app is built on its own and must not
 * reach across into the product's source tree.
 */

const TITLE = 'Siffty — Instagram DMs, sorted and answered';
const DESCRIPTION =
  'Siffty reads every message sent to your Instagram business account, spots the real leads, and replies to common questions from your own prices and policies.';

export const metadata = {
  metadataBase: new URL('https://siffty.com'),
  title: TITLE,
  description: DESCRIPTION,
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'Siffty',
    type: 'website',
    url: 'https://siffty.com',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport = {
  themeColor: '#0d0e1f',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import "./globals.css";
// Internal design tokens, namespaced --ui-* so they cannot collide with the
// globals.css tokens the approved external pages render through.
import "./tokens.css";
import { meta } from "@/content/copy";

export const metadata = {
  title: meta.root.title,
  description: meta.root.description,
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: meta.root.title,
    description: meta.root.description,
    siteName: "Siffty",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: meta.root.title,
    description: meta.root.description,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}

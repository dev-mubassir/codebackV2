import "./globals.css";
// Internal design tokens, namespaced --ui-* so they cannot collide with the
// globals.css tokens the approved external pages render through.
import "./tokens.css";
import { meta } from "@/content/copy";

export const metadata = {
  title: meta.root.title,
  description: meta.root.description,
  // No `icons` block: src/app/{icon.png,apple-icon.png,favicon.ico} are picked
  // up by Next's app-directory convention, which emits the <link> tags with
  // correct sizes and cache-busting hashes. An explicit block here would
  // override them and pin the old files.
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

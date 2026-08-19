import "./globals.css";

export const metadata = {
  title: "Codeback — AI-Powered Instagram DM Assistant",
  description: "Manage your Instagram Direct Messages from a unified inbox. Connect your Professional account and respond to DMs in real-time.",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
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

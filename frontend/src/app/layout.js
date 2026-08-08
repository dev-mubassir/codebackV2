import "./globals.css";

export const metadata = {
  title: "Codeback — Instagram DM Inbox",
  description: "Manage your Instagram Direct Messages from a unified inbox. Connect your Professional account and respond to DMs in real-time.",
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

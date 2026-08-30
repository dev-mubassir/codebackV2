import { meta } from '@/content/copy';

export const metadata = {
  title: meta.settings.title,
  description: meta.settings.description,
};

export default function SettingsLayout({ children }) {
  return children;
}

import { meta } from '@/content/copy';

export const metadata = {
  title: meta.notifications.title,
  description: meta.notifications.description,
};

export default function NotificationsLayout({ children }) {
  return children;
}

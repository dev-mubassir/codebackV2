import { meta } from '@/content/copy';

export const metadata = {
  title: meta.inbox.title,
  description: meta.inbox.description,
};

export default function InboxLayout({ children }) {
  return children;
}

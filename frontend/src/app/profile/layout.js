import { meta } from '@/content/copy';

export const metadata = {
  title: meta.account.title,
  description: meta.account.description,
};

export default function ProfileLayout({ children }) {
  return children;
}

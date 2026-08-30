import { meta } from '@/content/copy';

export const metadata = {
  title: meta.register.title,
  description: meta.register.description,
};

export default function RegisterLayout({ children }) {
  return children;
}

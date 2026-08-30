import { meta } from '@/content/copy';

export const metadata = {
  title: meta.login.title,
  description: meta.login.description,
};

export default function LoginLayout({ children }) {
  return children;
}

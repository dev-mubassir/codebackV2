import { autodm } from '@/app/components/autodm/copy';

export const metadata = {
  title: autodm.meta.title,
  description: autodm.meta.description,
};

export default function AutoDmLayout({ children }) {
  return children;
}

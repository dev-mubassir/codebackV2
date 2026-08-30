import { meta } from '@/content/copy';

export const metadata = {
  title: meta.dashboard.title,
  description: meta.dashboard.description,
};

export default function DashboardLayout({ children }) {
  return children;
}

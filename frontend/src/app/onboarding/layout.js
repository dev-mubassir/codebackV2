import { meta } from '@/content/copy';

export const metadata = {
  title: meta.onboarding.title,
  description: meta.onboarding.description,
};

export default function OnboardingLayout({ children }) {
  return children;
}

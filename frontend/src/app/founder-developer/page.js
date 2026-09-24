import FounderContent from './FounderContent';

export const metadata = {
  title: 'Founder & Developer — The Story Behind Siffty',
  description:
    'The journey of building Siffty from scratch in 6 months while studying B.Sc. Computer Science. An authentic breakdown of engineering, Meta Graph APIs, database architecture, and solo SaaS operations.',
  openGraph: {
    title: 'Founder & Developer — Siffty',
    description:
      'One person. One SaaS. Built from scratch while studying B.Sc. Computer Science.',
    images: ['/assets/founder-white-shirt.png'],
  },
};

export default function FounderDeveloperPage() {
  return <FounderContent />;
}

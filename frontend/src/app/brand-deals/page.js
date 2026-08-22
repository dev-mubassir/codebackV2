'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BrandDealsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/inbox');
  }, [router]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-page)' }}>
      <div className="spinner spinner-lg" />
    </div>
  );
}

'use client';

/** Auto DM — edit an existing automation (same wizard, prefilled). */

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/app/components/ui/AppShell';
import { EmptyState, ErrorState, Skeleton } from '@/app/components/ui';
import useAutoDmPage from '@/app/components/autodm/useAutoDmPage';
import AutomationWizard from '@/app/components/autodm/AutomationWizard';
import { getAutomation, apiErrorMessage } from '@/lib/autodmApi';
import { autodm as t } from '@/app/components/autodm/copy';

function EditAutomationContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const { user, state } = useAutoDmPage();
  const [automation, setAutomation] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (state !== 'ready' || !id) return;
    let cancelled = false;
    getAutomation(id)
      .then((a) => { if (!cancelled) setAutomation(a); })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, t.loadError)); });
    return () => { cancelled = true; };
  }, [state, id]);

  let body;
  if (state === 'loading') body = <Skeleton lines={6} height={48} />;
  else if (state === 'error') body = <ErrorState message={t.loadError} onRetry={() => window.location.reload()} />;
  else if (state === 'unavailable') body = <Skeleton lines={6} height={48} />; // redirecting
  else if (error || !id) body = <ErrorState message={error || t.loadError} />;
  else if (!automation) body = <Skeleton lines={6} height={48} />;
  else body = <AutomationWizard accountId={automation.instagramAccountId} automation={automation} />;

  return (
    <AppShell user={user} title={t.wizard.editTitle} activeRoute="/autodm">
      {body}
    </AppShell>
  );
}

export default function EditAutomationPage() {
  return (
    <Suspense fallback={null}>
      <EditAutomationContent />
    </Suspense>
  );
}

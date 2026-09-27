'use client';

/** Auto DM — create an automation (4-step wizard) for one ready account. */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/app/components/ui/AppShell';
import { EmptyState, ErrorState, Skeleton } from '@/app/components/ui';
import useAutoDmPage from '@/app/components/autodm/useAutoDmPage';
import AutomationWizard from '@/app/components/autodm/AutomationWizard';
import { autodm as t } from '@/app/components/autodm/copy';

function NewAutomationContent() {
  const searchParams = useSearchParams();
  const { user, state, accounts } = useAutoDmPage();
  const wanted = searchParams.get('account');
  const account = accounts.find((a) => a.id === wanted && a.ready) || accounts.find((a) => a.ready) || null;

  let body;
  if (state === 'loading') body = <Skeleton lines={6} height={48} />;
  else if (state === 'error') body = <ErrorState message={t.loadError} onRetry={() => window.location.reload()} />;
  else if (state === 'unavailable') body = <EmptyState title={t.unavailable.title} body={t.unavailable.body} />;
  else if (!account) body = <EmptyState title={t.reconnect.title} body={t.reconnect.body} />;
  else body = <AutomationWizard accountId={account.id} />;

  return (
    <AppShell user={user} title={t.wizard.newTitle} activeRoute="/autodm">
      {body}
    </AppShell>
  );
}

export default function NewAutomationPage() {
  return (
    <Suspense fallback={null}>
      <NewAutomationContent />
    </Suspense>
  );
}

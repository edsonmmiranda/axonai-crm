'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Props {
  defaultTab:        'admins' | 'invitations' | 'requests';
  pendingInvitations: number;
  pendingRequests:    number;
  adminsSlot:         ReactNode;
  invitationsSlot:    ReactNode;
  requestsSlot:       ReactNode;
}

export function AdminsTabs({
  defaultTab,
  pendingInvitations,
  pendingRequests,
  adminsSlot,
  invitationsSlot,
  requestsSlot,
}: Props) {
  const router       = useRouter();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === 'admins') next.delete('tab');
    else                    next.set('tab', value);
    const qs = next.toString();
    router.replace(qs ? `/admin/admins?${qs}` : '/admin/admins', { scroll: false });
  }

  return (
    <Tabs defaultValue={defaultTab} onValueChange={handleChange} className="flex flex-col gap-4">
      <TabsList className="self-start">
        <TabsTrigger value="admins">Admins ativos</TabsTrigger>
        <TabsTrigger value="invitations">
          Convites pendentes
          {pendingInvitations > 0 && (
            <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-action-primary/15 px-1.5 text-xs font-semibold text-action-primary">
              {pendingInvitations}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="requests">
          Pedidos de reset MFA
          {pendingRequests > 0 && (
            <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-feedback-warning-bg px-1.5 text-xs font-semibold text-feedback-warning-fg">
              {pendingRequests}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="admins" className="mt-0">
        <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
          {adminsSlot}
        </div>
      </TabsContent>

      <TabsContent value="invitations" className="mt-0">
        <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
          {invitationsSlot}
        </div>
      </TabsContent>

      <TabsContent value="requests" className="mt-0">
        <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
          {requestsSlot}
        </div>
      </TabsContent>
    </Tabs>
  );
}

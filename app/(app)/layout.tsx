import type { ReactNode } from 'react';
import Shell from '@/components/Shell';
import { clerkEnabled, requireCtx } from '@/lib/auth';
import { db } from '@/lib/db';
import { aiConnected } from '@/lib/operator';
import { proposals } from '@/lib/proposals';
import { canAct, canOpen, NAV, ROLES } from '@/lib/roles';
import { today } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const c = await requireCtx();
  const [queue, openShoots, tickets, exceptions] = await Promise.all([
    proposals(c.tenantId, c.tenant.rulesOff),
    db.shoot.count({ where: { tenantId: c.tenantId, photographerId: null, date: { gte: today() } } }),
    db.ticket.count({ where: { tenantId: c.tenantId, status: 'open' } }),
    db.orderException.count({ where: { tenantId: c.tenantId, resolvedAt: null } }),
  ]);
  const badge: Record<string, number> = { '/': queue.filter((p) => canAct(c.role, p.area)).length, '/schedule': openShoots, '/support': tickets, '/orders': exceptions };
  const nav = NAV.map(([g, items]) => [g, items.filter((i) => canOpen(c.role, i[0])).map((i) => [i[0], i[1], badge[i[0]] ?? 0])] as [string, [string, string, number][]]).filter((g) => g[1].length);
  let signOut: ReactNode = null;
  if (clerkEnabled) {
    const { UserButton } = await import('@clerk/nextjs');
    signOut = <UserButton />;
  }
  return (
    <div style={{ display: 'contents', ['--hue' as string]: c.tenant.brandHue }}>
      <Shell nav={nav} studio={c.tenant.name} role={c.role} roles={[...ROLES]} demo={c.demo} signOut={signOut} engine={aiConnected() ? 'claude' : 'builtin'}>{children}</Shell>
    </div>
  );
}

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import { execute } from '@/lib/ops';
import { proposals } from '@/lib/proposals';

export const dynamic = 'force-dynamic';

/** Scheduled job: for each studio, runs approval-queue items in areas set to "Run on its own". */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? '';
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let ran = 0;
  for (const t of await db.tenant.findMany()) {
    const autonomy = (t.autonomy ?? {}) as Record<string, string>;
    for (const p of await proposals(t.id, t.rulesOff)) {
      if (autonomy[p.area] !== 'auto') continue;
      const res = await execute({ tenantId: t.id, role: 'Owner', actor: 'SnapFlow (scheduled)', rulesOff: t.rulesOff }, p.actions);
      ran += res.steps.filter((s) => s.ok).length;
    }
  }
  return NextResponse.json({ ran });
}

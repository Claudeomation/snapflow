import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { applyOrders, hashToken, summary } from '@/lib/storefront';

export const dynamic = 'force-dynamic';

const Body = z.object({
  galleryId: z.string().min(1).max(60),
  amountIs: z.enum(['order', 'line']).default('order'),
  addMissing: z.boolean().default(false),
  orders: z.array(z.object({
    accessCode: z.string().max(40).optional(),
    studentName: z.string().max(160).optional(),
    orderRef: z.string().max(80).optional(),
    status: z.string().max(60).optional(),
    package: z.string().max(200).optional(),
    amount: z.number().min(0).max(1_000_000).optional(),
    parentEmail: z.string().max(200).optional(),
  })).min(1).max(20000),
});

/**
 * Machine entry point for order data, for a storefront connection or a script.
 * Authorization: Bearer <ingest key from Settings>. The key identifies the studio.
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const tenant = token ? await db.tenant.findUnique({ where: { ingestTokenHash: hashToken(token) } }) : null;
  if (!tenant) return NextResponse.json({ error: 'Invalid or missing ingest key' }, { status: 401 });
  let json: unknown;
  try { json = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }
  const body = Body.safeParse(json);
  if (!body.success) return NextResponse.json({ error: 'Invalid body', issues: body.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`) }, { status: 400 });
  try {
    const r = await applyOrders(tenant.id, body.data.galleryId, body.data.orders.map((o) => ({ ...o, amountCents: Math.round((o.amount ?? 0) * 100) })), { amountIs: body.data.amountIs, addMissing: body.data.addMissing, source: 'api', actor: 'Storefront connection' });
    return NextResponse.json({ ok: true, summary: summary(r), rows: r.rows, students: r.students, added: r.added, unmatched: r.unmatched });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Import failed' }, { status: 404 });
  }
}

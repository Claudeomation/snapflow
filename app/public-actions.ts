'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db';
import { signContract } from '@/lib/ops';

/** Public: a parent or school sends a question from the portal. Capped per studio per hour. */
export async function submitTicket(slug: string, form: FormData) {
  const tenant = await db.tenant.findUnique({ where: { slug } });
  if (!tenant) redirect('/');
  const v = z.object({ name: z.string().trim().min(1).max(120), email: z.string().email().max(200), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(4000), website: z.string().max(0) })
    .safeParse({ name: form.get('name'), email: form.get('email'), subject: form.get('subject'), body: form.get('body'), website: form.get('website') ?? '' });
  if (!v.success) redirect(`/portal/${slug}?sent=invalid`);
  const recent = await db.ticket.count({ where: { tenantId: tenant.id, createdAt: { gte: new Date(Date.now() - 3600000) } } });
  if (recent >= 60) redirect(`/portal/${slug}?sent=busy`);
  await db.ticket.create({ data: { tenantId: tenant.id, subject: v.data.subject, fromName: v.data.name, fromEmail: v.data.email, body: v.data.body, dueAt: new Date(Date.now() + 24 * 3600000) } });
  redirect(`/portal/${slug}?sent=yes`);
}

/** Public: the school signs from the emailed link. The token is the credential. */
export async function signFromLink(token: string, form: FormData) {
  const v = z.object({ name: z.string().trim().min(2).max(120), agree: z.literal('on') }).safeParse({ name: form.get('name'), agree: form.get('agree') });
  const k = await db.contract.findUnique({ where: { signToken: token } });
  if (!k) redirect('/');
  if (!v.success) redirect(`/sign/${token}?error=1`);
  if (k.status !== 'signed') {
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: k.tenantId } });
    const r = await signContract(k.tenantId, k.id, v.data.name, tenant.rulesOff);
    await db.auditLog.create({ data: { tenantId: k.tenantId, runId: crypto.randomUUID(), actor: `${v.data.name} (signing link)`, op: 'mark_signed', label: `${k.title} signed`, note: r.note } });
  }
  redirect(`/sign/${token}`);
}

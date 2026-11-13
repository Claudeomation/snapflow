'use server';

import { randomInt } from 'crypto';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireCtx } from '@/lib/auth';
import { describe, execute, undoRun, type Action, type Step } from '@/lib/ops';
import { interpret } from '@/lib/operator';
import { canAct, ROLES, type Area } from '@/lib/roles';
import { addDays, today } from '@/lib/format';
import { applyOrders, detectMapping, FIELDS, mapRows, parseCsv, rotateIngestToken, summary, type FieldKey, type Mapping } from '@/lib/storefront';

const ActionList = z.array(z.object({ op: z.string().max(40), id: z.string().max(60).optional(), id2: z.string().max(60).optional(), value: z.string().max(4000).optional() })).max(40);
const refresh = () => revalidatePath('/', 'layout');

export type RunResult = { runId: string; steps: Step[] };

export async function runActions(actions: Action[]): Promise<RunResult> {
  const c = await requireCtx();
  const res = await execute({ tenantId: c.tenantId, role: c.role, actor: c.user.name, rulesOff: c.tenant.rulesOff }, ActionList.parse(actions));
  refresh();
  return res;
}

export async function undo(runId: string): Promise<string> {
  const c = await requireCtx();
  const msg = await undoRun(c.tenantId, z.string().uuid().parse(runId));
  refresh();
  return msg;
}

export async function askOperator(text: string, history: { role: 'user' | 'assistant'; content: string }[], path: string) {
  const c = await requireCtx();
  const q = z.string().min(1).max(2000).parse(text);
  const h = z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) })).max(12).parse(history);
  const plan = await interpret({ tenantId: c.tenantId, rulesOff: c.tenant.rulesOff, role: c.role, path }, q, h);
  const steps = await describe(c.tenantId, c.tenant.autonomy, plan.actions);
  return { say: plan.say, goto: plan.goto, steps, engine: plan.engine };
}

export async function dismiss(key: string) {
  const c = await requireCtx();
  await db.dismissal.upsert({ where: { tenantId_key: { tenantId: c.tenantId, key } }, create: { tenantId: c.tenantId, key: z.string().max(600).parse(key) }, update: {} });
  refresh();
}

const text = (max = 200) => z.string().trim().max(max);
const dollars = z.coerce.number().min(0).max(100_000_000).transform((n) => Math.round(n * 100));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => new Date(`${s}T00:00:00Z`));
const KINDS = {
  school: { area: 'Scheduling', schema: z.object({ name: text().min(1), district: text(), zone: text(40), enrollment: z.coerce.number().int().min(0).max(100000), contactName: text(), contactEmail: z.union([z.literal(''), z.string().email()]), gear: text() }) },
  photographer: { area: 'Scheduling', schema: z.object({ name: text().min(1), email: z.union([z.literal(''), z.string().email()]), zone: text(40), payType: z.enum(['Hourly', 'Day rate', 'Salary']) }) },
  shoot: { area: 'Scheduling', schema: z.object({ schoolId: text(60).min(1), type: text().min(1), date, students: z.coerce.number().int().min(0).max(100000) }) },
  deal: { area: 'Sales', schema: z.object({ name: text().min(1), detail: text(), value: dollars, contactEmail: z.union([z.literal(''), z.string().email()]), nextStep: text() }) },
  contract: { area: 'Contracts', schema: z.object({ schoolId: text(60).min(1), title: text().min(1), scope: text(2000), value: dollars, termEnds: z.union([z.literal(''), date]) }) },
  gallery: { area: 'Orders', schema: z.object({ schoolId: text(60).min(1), name: text().min(1), closesOn: date, lastYearPart: z.union([z.literal(''), z.coerce.number().int().min(0).max(100)]) }) },
  exception: { area: 'Orders', schema: z.object({ kind: text(60).min(1), subject: text().min(1), fix: text(1000) }) },
  ticket: { area: 'Support', schema: z.object({ schoolId: text(60), subject: text().min(1), fromName: text(), fromEmail: z.union([z.literal(''), z.string().email()]), priority: z.enum(['Low', 'Normal', 'High']), body: text(4000).min(1) }) },
  invoice: { area: 'Accounting', schema: z.object({ schoolId: text(60).min(1), description: text().min(1), amount: dollars }) },
} as const;
export type Kind = keyof typeof KINDS;

const SLA_HOURS = { Low: 72, Normal: 24, High: 4 };

export async function createRecord(kind: Kind, raw: Record<string, string>): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await requireCtx();
  const def = KINDS[kind];
  if (!def) return { ok: false, error: 'Unknown record type' };
  if (!canAct(c.role, def.area as Area)) return { ok: false, error: `Your role cannot add to ${def.area.toLowerCase()}` };
  const parsed = def.schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('. ') };
  const tenantId = c.tenantId;
  const ownSchool = async (id: string) => !!(await db.school.findFirst({ where: { id, tenantId }, select: { id: true } }));
  const schoolId = (parsed.data as { schoolId?: string }).schoolId;
  if (schoolId && !(await ownSchool(schoolId))) return { ok: false, error: 'School not found' };

  if (kind === 'school') await db.school.create({ data: { tenantId, ...(parsed.data as z.infer<typeof KINDS.school.schema>) } });
  else if (kind === 'photographer') await db.photographer.create({ data: { tenantId, ...(parsed.data as z.infer<typeof KINDS.photographer.schema>) } });
  else if (kind === 'shoot') await db.shoot.create({ data: { tenantId, ...(parsed.data as z.infer<typeof KINDS.shoot.schema>) } });
  else if (kind === 'deal') { const v = parsed.data as z.infer<typeof KINDS.deal.schema>; await db.deal.create({ data: { tenantId, name: v.name, detail: v.detail, valueCents: v.value, contactEmail: v.contactEmail, nextStep: v.nextStep, rep: c.user.name } }); }
  else if (kind === 'contract') { const v = parsed.data as z.infer<typeof KINDS.contract.schema>; await db.contract.create({ data: { tenantId, schoolId: v.schoolId, title: v.title, scope: v.scope, valueCents: v.value, termEnds: v.termEnds || null } }); }
  else if (kind === 'gallery') {
    const v = parsed.data as z.infer<typeof KINDS.gallery.schema>;
    const students = await db.student.findMany({ where: { tenantId, schoolId: v.schoolId }, select: { id: true } });
    if (!students.length) return { ok: false, error: 'Import the school roster first, so each student gets an access code' };
    const g = await db.gallery.create({ data: { tenantId, schoolId: v.schoolId, name: v.name, closesOn: v.closesOn, lastYearPart: v.lastYearPart === '' ? null : v.lastYearPart } });
    const code = () => Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('');
    await db.galleryEntry.createMany({ data: students.map((s) => ({ tenantId, galleryId: g.id, studentId: s.id, accessCode: `${code().slice(0, 4)}-${code().slice(4)}` })) });
  } else if (kind === 'exception') await db.orderException.create({ data: { tenantId, ...(parsed.data as z.infer<typeof KINDS.exception.schema>) } });
  else if (kind === 'ticket') { const v = parsed.data as z.infer<typeof KINDS.ticket.schema>; await db.ticket.create({ data: { tenantId, schoolId: v.schoolId || null, subject: v.subject, fromName: v.fromName, fromEmail: v.fromEmail, priority: v.priority, body: v.body, dueAt: new Date(Date.now() + SLA_HOURS[v.priority] * 3600000) } }); }
  else if (kind === 'invoice') { const v = parsed.data as z.infer<typeof KINDS.invoice.schema>; await db.invoice.create({ data: { tenantId, schoolId: v.schoolId, description: v.description, amountCents: v.amount, issuedOn: today(), dueOn: addDays(today(), 30) } }); }
  refresh();
  return { ok: true };
}

/** Roster import: one student per line as "Name, Homeroom, Parent email". Existing names are skipped. */
export async function importRoster(schoolId: string, csv: string): Promise<{ ok: boolean; message: string }> {
  const c = await requireCtx();
  if (!canAct(c.role, 'Scheduling')) return { ok: false, message: 'Your role cannot import rosters' };
  const school = await db.school.findFirst({ where: { id: schoolId, tenantId: c.tenantId }, include: { students: { select: { name: true } } } });
  if (!school) return { ok: false, message: 'School not found' };
  const have = new Set(school.students.map((s) => s.name.toLowerCase()));
  const rows = z.string().max(400000).parse(csv).split(/\r?\n/).map((l) => l.split(',').map((x) => x.trim())).filter((r) => r[0] && !/^name$/i.test(r[0]));
  const fresh = rows.filter((r) => !have.has(r[0].toLowerCase())).slice(0, 5000);
  const bad = fresh.filter((r) => r[2] && !z.string().email().safeParse(r[2]).success).length;
  await db.student.createMany({ data: fresh.map((r) => ({ tenantId: c.tenantId, schoolId, name: r[0].slice(0, 120), homeroom: (r[1] ?? '').slice(0, 60), parentEmail: r[2] && z.string().email().safeParse(r[2]).success ? r[2] : '' })) });
  refresh();
  return { ok: true, message: `${fresh.length} students added, ${rows.length - fresh.length} already on the roster${bad ? `, ${bad} had an invalid email that was left blank` : ''}` };
}

export async function saveDraft(ticketId: string, draft: string) {
  const c = await requireCtx();
  if (!canAct(c.role, 'Support')) return;
  await db.ticket.updateMany({ where: { id: ticketId, tenantId: c.tenantId }, data: { draft: z.string().max(8000).parse(draft) } });
  refresh();
}

export async function recordPose(shootId: string, studentId: string, flag: string) {
  const c = await requireCtx();
  if (!canAct(c.role, 'Scheduling')) return;
  const [shoot, student] = await Promise.all([db.shoot.findFirst({ where: { id: shootId, tenantId: c.tenantId } }), db.student.findFirst({ where: { id: studentId, tenantId: c.tenantId } })]);
  if (!shoot || !student || shoot.schoolId !== student.schoolId) return;
  const n = await db.pose.count({ where: { shootId, studentId } });
  if (n >= 3) return;
  await db.pose.create({ data: { tenantId: c.tenantId, shootId, studentId, number: n + 1, flag: z.enum(['', 'Eyes closed', 'Glare', 'Head turned', 'Out of focus']).parse(flag) } });
  refresh();
}

export async function acceptPose(shootId: string, studentId: string, number: number | null) {
  const c = await requireCtx();
  if (!canAct(c.role, 'Scheduling')) return;
  const where = { tenantId: c.tenantId, shootId, studentId };
  if (number === null) await db.pose.deleteMany({ where });
  else {
    await db.pose.updateMany({ where, data: { accepted: false } });
    await db.pose.updateMany({ where: { ...where, number }, data: { accepted: true } });
  }
  refresh();
}

export async function saveStudio(raw: { name: string; brandHue: string }) {
  const c = await requireCtx();
  if (!canAct(c.role, 'Settings')) return;
  const v = z.object({ name: text(80).min(1), brandHue: z.coerce.number().int().min(0).max(360) }).parse(raw);
  await db.tenant.update({ where: { id: c.tenantId }, data: v });
  refresh();
}

export async function addMember(raw: { name: string; email: string; role: string }): Promise<{ ok: boolean; error?: string }> {
  const c = await requireCtx();
  if (c.role !== 'Owner') return { ok: false, error: 'Only the Owner can add people' };
  const v = z.object({ name: text(80).min(1), email: z.string().email().transform((s) => s.toLowerCase()), role: z.enum(ROLES) }).safeParse(raw);
  if (!v.success) return { ok: false, error: 'Enter a name, a valid email and a role' };
  if (await db.user.findFirst({ where: { tenantId: c.tenantId, email: v.data.email } })) return { ok: false, error: 'That email is already on the team' };
  await db.user.create({ data: { tenantId: c.tenantId, ...v.data } });
  refresh();
  return { ok: true };
}

export async function removeMember(id: string) {
  const c = await requireCtx();
  if (c.role !== 'Owner' || id === c.user.id) return;
  await db.user.deleteMany({ where: { id, tenantId: c.tenantId } });
  refresh();
}

/** Demo mode only: preview the app as another role. */
export async function setDemoRole(role: string) {
  const c = await requireCtx();
  if (!c.demo) return;
  (await cookies()).set('demo-role', z.enum(ROLES).parse(role), { httpOnly: true, sameSite: 'lax', path: '/' });
  refresh();
}

// ---- Storefront sync ----

const MappingSchema = z.record(z.string(), z.string().max(200));
const cleanMapping = (m: Record<string, string>, headers: string[]): Mapping =>
  Object.fromEntries(Object.entries(m).filter(([k, v]) => k in FIELDS && headers.includes(v))) as Mapping;

export type ImportPreview = { ok: true; headers: string[]; mapping: Mapping; sample: Record<string, string>[]; rows: number; matched: number; students: number; unmatched: number; unmatchedSample: string[]; wouldAdd: number } | { ok: false; error: string };

/** Reads an export file, guesses which column is which, and reports what an import would do without changing anything. */
export async function previewImport(galleryId: string, csv: string, mapping: Record<string, string> | null, addMissing: boolean, amountIs: 'order' | 'line'): Promise<ImportPreview> {
  const c = await requireCtx();
  if (!canAct(c.role, 'Orders')) return { ok: false, error: 'Your role cannot import orders' };
  const { headers, rows } = parseCsv(z.string().max(8_000_000).parse(csv));
  if (!headers.length || !rows.length) return { ok: false, error: 'That file has no rows. Export it as CSV and try again.' };
  if (rows.length > 20000) return { ok: false, error: 'That file has more than 20,000 rows. Export one job at a time.' };
  const m = mapping ? cleanMapping(MappingSchema.parse(mapping), headers) : detectMapping(headers);
  if (!m.accessCode && !m.studentName && !(m.firstName || m.lastName)) return { ok: true, headers, mapping: m, sample: rows.slice(0, 3), rows: rows.length, matched: 0, students: 0, unmatched: rows.length, unmatchedSample: [], wouldAdd: 0 };
  try {
    const r = await applyOrders(c.tenantId, galleryId, mapRows(rows, m), { amountIs, addMissing, source: 'file', actor: c.user.name, dryRun: true });
    return { ok: true, headers, mapping: m, sample: rows.slice(0, 3), rows: r.rows, matched: r.matched, students: r.students, unmatched: r.unmatched, unmatchedSample: r.unmatchedSample, wouldAdd: r.added };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read that file' };
  }
}

export async function runImport(galleryId: string, csv: string, mapping: Record<string, string>, addMissing: boolean, amountIs: 'order' | 'line', fileName: string): Promise<{ ok: true; result: RunResult } | { ok: false; error: string }> {
  const c = await requireCtx();
  if (!canAct(c.role, 'Orders')) return { ok: false, error: 'Your role cannot import orders' };
  const { headers, rows } = parseCsv(z.string().max(8_000_000).parse(csv));
  if (rows.length > 20000) return { ok: false, error: 'That file has more than 20,000 rows.' };
  const m = cleanMapping(MappingSchema.parse(mapping), headers);
  if (!m.accessCode && !m.studentName && !(m.firstName || m.lastName)) return { ok: false, error: 'Choose the column that holds the access code or the student name.' };
  try {
    const r = await applyOrders(c.tenantId, galleryId, mapRows(rows, m), { amountIs, addMissing, source: 'file', fileName: fileName.slice(0, 120), actor: c.user.name });
    refresh();
    return { ok: true, result: { runId: r.runId!, steps: [{ action: { op: 'import_orders' }, label: `Import ${fileName || 'orders'}`, area: 'Orders', needsOK: false, ok: true, note: summary(r) }] } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Import failed' };
  }
}

/** Owner only. Returns the new key once; only its hash is stored. The previous key stops working. */
export async function newIngestKey(): Promise<string | null> {
  const c = await requireCtx();
  if (c.role !== 'Owner') return null;
  const t = await rotateIngestToken(c.tenantId);
  refresh();
  return t;
}
export type { FieldKey };

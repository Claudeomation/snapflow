import { randomUUID } from 'crypto';
import { db } from './db';
import { deliver, deliveryNote } from './outbox';
import { canAct, type Area, type Role } from './roles';
import { addDays, dayKey, dayLabel, money, today } from './format';

/**
 * One vocabulary of operations. Buttons, the approval queue, the scheduled job and the
 * operator all go through execute(), so permissions, the audit log and undo apply everywhere.
 */
export type Action = { op: string; id?: string; id2?: string; value?: string };
type Undo = { kind: 'update'; model: string; id: string; data: Record<string, unknown> } | { kind: 'delete'; model: string; ids: string[] };
type RunCtx = { tenantId: string; runId: string; rulesOff: string[] };
type Result = { note: string; undo?: Undo[] };
type Op = { area: Area; risk: 'internal' | 'outbound'; label: (t: string, a: Action) => Promise<string>; run: (c: RunCtx, a: Action) => Promise<Result> };

export const DEPTS: [string, string][] = [
  ['Scheduling', 'Assign a photographer and start the briefing'],
  ['Marketing', 'Build the parent email and text campaign'],
  ['Accounting', 'Create the customer record for invoicing'],
  ['Roster', 'Collect or sync the student roster'],
  ['Fulfillment', 'Set up the lab account and delivery address'],
  ['Support', 'Add the school to the helpdesk'],
];
export const STAGES = ['Lead', 'Contacted', 'Proposal', 'Negotiation', 'Won'];
export const RULES: Record<string, { name: string; when: string }> = {
  signed_cascade: { name: 'Contract signed → every department gets its task', when: 'A contract is signed' },
  staffing: { name: 'Open shoot → propose the best available photographer', when: 'A shoot in the next 14 days has no photographer' },
  gallery_reminder: { name: 'Gallery closing → remind families who have not ordered', when: '7 days before a gallery closes, if participation is behind' },
  ticket_reply: { name: 'Ticket has a draft → propose sending it', when: 'A normal-priority ticket has a drafted reply' },
  invoice_chase: { name: 'Invoice late → propose a payment reminder', when: 'An invoice is past its due date' },
  renewal: { name: 'Term ending → draft the renewal', when: 'A signed contract ends within 60 days' },
};

const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const need = <T>(v: T | null | undefined, what: string): T => {
  if (!v) throw new Error(`${what} not found`);
  return v;
};
const plural = (n: number) => `${n} ${n === 1 ? 'shoot' : 'shoots'}`;
const shootName = (s: { type: string; school: { name: string } }) => `${s.school.name} ${s.type.toLowerCase()}`;

/** Best photographer for a shoot: free that day, not on leave, same zone first, then lightest load. */
export async function suggestPhotographer(tenantId: string, shoot: { date: Date; school: { zone: string } }, extraBooked: Set<string> = new Set()) {
  const crew = await db.photographer.findMany({ where: { tenantId }, include: { shoots: { where: { date: { gte: today() } }, select: { date: true } } } });
  const key = dayKey(shoot.date);
  const free = crew.filter((p) => !p.daysOff.some((d) => dayKey(d) === key) && !p.shoots.some((s) => dayKey(s.date) === key) && !extraBooked.has(`${p.id}:${key}`));
  if (!free.length) return null;
  const same = free.filter((p) => p.zone && p.zone === shoot.school.zone);
  const pool = (same.length ? same : free).sort((a, b) => a.shoots.length - b.shoots.length);
  const p = pool[0];
  return { id: p.id, name: p.name, why: same.length ? `${p.zone} zone, free that day, ${plural(p.shoots.length)} booked` : `free that day with the lightest load (${plural(p.shoots.length)})` };
}

async function assign(c: RunCtx, shootId: string, photographerId: string): Promise<Result> {
  const shoot = need(await db.shoot.findFirst({ where: { id: shootId, tenantId: c.tenantId }, include: { school: true } }), 'Shoot');
  const p = need(await db.photographer.findFirst({ where: { id: photographerId, tenantId: c.tenantId } }), 'Photographer');
  await db.shoot.update({ where: { id: shoot.id }, data: { photographerId: p.id, status: 'briefed' } });
  const sent = await deliver(c.tenantId, c.runId, p.email, `Briefing: ${shootName(shoot)} on ${dayLabel(shoot.date)}`,
    `Hi ${p.name},\n\nYou are on ${shoot.school.name} for ${shoot.type.toLowerCase()} on ${dayLabel(shoot.date)}.\nStudents: ${shoot.students}\nContact: ${shoot.school.contactName || 'front office'}\nGear: ${shoot.school.gear || 'standard kit'}\n`);
  return { note: `Briefing to ${p.name}: ${deliveryNote([sent])}`, undo: [{ kind: 'update', model: 'shoot', id: shoot.id, data: { photographerId: shoot.photographerId, status: shoot.status } }] };
}

/** Marks a contract signed and, unless the rule is off, creates one task per department. */
export async function signContract(tenantId: string, contractId: string, signedBy: string, rulesOff: string[]): Promise<Result> {
  const k = need(await db.contract.findFirst({ where: { id: contractId, tenantId } }), 'Contract');
  if (k.status === 'signed') return { note: 'Already signed' };
  await db.contract.update({ where: { id: k.id }, data: { status: 'signed', signedAt: new Date(), signedBy } });
  const undo: Undo[] = [{ kind: 'update', model: 'contract', id: k.id, data: { status: k.status, signedAt: k.signedAt, signedBy: k.signedBy } }];
  if (rulesOff.includes('signed_cascade')) return { note: 'Signed. Department tasks are switched off', undo };
  const ids: string[] = [];
  for (const [dept, label] of DEPTS) ids.push((await db.task.create({ data: { tenantId, contractId: k.id, dept, label } })).id);
  undo.push({ kind: 'delete', model: 'task', ids });
  return { note: `Signed. ${DEPTS.length} department tasks created`, undo };
}

export const OPS: Record<string, Op> = {
  assign: {
    area: 'Scheduling', risk: 'internal',
    label: async (t, a) => {
      const s = await db.shoot.findFirst({ where: { id: a.id, tenantId: t }, include: { school: true } });
      const p = await db.photographer.findFirst({ where: { id: a.id2, tenantId: t } });
      return `Assign ${p?.name ?? 'a photographer'} to ${s ? shootName(s) : 'the shoot'}`;
    },
    run: (c, a) => assign(c, a.id ?? '', a.id2 ?? ''),
  },
  auto_schedule: {
    area: 'Scheduling', risk: 'internal',
    label: async () => 'Assign every open shoot to the best available photographer',
    run: async (c) => {
      const open = await db.shoot.findMany({ where: { tenantId: c.tenantId, photographerId: null, date: { gte: today() } }, include: { school: true }, orderBy: { date: 'asc' } });
      const undo: Undo[] = [];
      const booked = new Set<string>();
      let n = 0;
      for (const s of open) {
        const pick = await suggestPhotographer(c.tenantId, s, booked);
        if (!pick) continue;
        booked.add(`${pick.id}:${dayKey(s.date)}`);
        undo.push(...((await assign(c, s.id, pick.id)).undo ?? []));
        n++;
      }
      return { note: n ? `${n} of ${open.length} open shoots assigned` : open.length ? 'No one is free on those days' : 'No open shoots', undo };
    },
  },
  shoot_status: {
    area: 'Scheduling', risk: 'internal',
    label: async (t, a) => {
      const s = await db.shoot.findFirst({ where: { id: a.id, tenantId: t }, include: { school: true } });
      return `Mark ${s ? shootName(s) : 'shoot'} as ${a.value}`;
    },
    run: async (c, a) => {
      if (!['scheduled', 'briefed', 'onsite', 'complete'].includes(a.value ?? '')) throw new Error('Unknown status');
      const s = need(await db.shoot.findFirst({ where: { id: a.id, tenantId: c.tenantId } }), 'Shoot');
      await db.shoot.update({ where: { id: s.id }, data: { status: a.value } });
      return { note: 'Status updated', undo: [{ kind: 'update', model: 'shoot', id: s.id, data: { status: s.status } }] };
    },
  },
  send_contract: {
    area: 'Contracts', risk: 'outbound',
    label: async (t, a) => `Send ${(await db.contract.findFirst({ where: { id: a.id, tenantId: t } }))?.title ?? 'contract'} for signature`,
    run: async (c, a) => {
      const k = need(await db.contract.findFirst({ where: { id: a.id, tenantId: c.tenantId }, include: { school: true } }), 'Contract');
      if (k.status === 'signed') return { note: 'Already signed' };
      const sent = await deliver(c.tenantId, c.runId, k.school.contactEmail, `Agreement for ${k.school.name}`,
        `Hello ${k.school.contactName || ''},\n\nYour agreement "${k.title}" (${money(k.valueCents)}) is ready to review and sign:\n${appUrl()}/sign/${k.signToken}\n`);
      await db.contract.update({ where: { id: k.id }, data: { status: k.status === 'draft' ? 'sent' : k.status, sentAt: new Date() } });
      return { note: `Signing link: ${deliveryNote([sent])}`, undo: [{ kind: 'update', model: 'contract', id: k.id, data: { status: k.status, sentAt: k.sentAt } }] };
    },
  },
  mark_signed: {
    area: 'Contracts', risk: 'internal',
    label: async (t, a) => `Record ${(await db.contract.findFirst({ where: { id: a.id, tenantId: t } }))?.title ?? 'contract'} as signed and start every department`,
    run: (c, a) => signContract(c.tenantId, a.id ?? '', 'Recorded by staff', c.rulesOff),
  },
  draft_renewal: {
    area: 'Contracts', risk: 'internal',
    label: async (t, a) => `Draft a renewal for ${(await db.contract.findFirst({ where: { id: a.id, tenantId: t }, include: { school: true } }))?.school.name ?? 'the school'}`,
    run: async (c, a) => {
      const k = need(await db.contract.findFirst({ where: { id: a.id, tenantId: c.tenantId }, include: { school: true } }), 'Contract');
      const n = await db.contract.create({ data: { tenantId: c.tenantId, schoolId: k.schoolId, title: `${k.school.name} · renewal`, scope: k.scope, valueCents: k.valueCents, termEnds: k.termEnds ? addDays(k.termEnds, 365) : null } });
      return { note: 'Draft created with the current scope and price. Review it, then send', undo: [{ kind: 'delete', model: 'contract', ids: [n.id] }] };
    },
  },
  complete_task: {
    area: 'Contracts', risk: 'internal',
    label: async (t, a) => `Complete task: ${(await db.task.findFirst({ where: { id: a.id, tenantId: t } }))?.label ?? ''}`,
    run: async (c, a) => {
      const k = need(await db.task.findFirst({ where: { id: a.id, tenantId: c.tenantId } }), 'Task');
      await db.task.update({ where: { id: k.id }, data: { done: true } });
      return { note: 'Done', undo: [{ kind: 'update', model: 'task', id: k.id, data: { done: k.done } }] };
    },
  },
  send_reminder: {
    area: 'Orders', risk: 'outbound',
    label: async (t, a) => {
      const g = await db.gallery.findFirst({ where: { id: a.id, tenantId: t }, include: { school: true, _count: { select: { entries: { where: { status: 'none' } } } } } });
      return g ? `Email ${g._count.entries} ${g.school.name} families who have not ordered` : 'Send order reminder';
    },
    run: async (c, a) => {
      const g = need(await db.gallery.findFirst({ where: { id: a.id, tenantId: c.tenantId }, include: { school: true, entries: { where: { status: 'none' }, include: { student: true } } } }), 'Gallery');
      const tenant = await db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } });
      const results: string[] = [];
      for (const e of g.entries)
        results.push(await deliver(c.tenantId, c.runId, e.student.parentEmail, `${g.school.name}: ${g.name} ordering closes ${dayLabel(g.closesOn)}`,
          `Hello,\n\n${e.student.name}'s ${g.name.toLowerCase()} are ready. Ordering closes ${dayLabel(g.closesOn)}.\nView them with access code ${e.accessCode}:\n${appUrl()}/portal/${tenant.slug}\n`));
      await db.gallery.update({ where: { id: g.id }, data: { remindedAt: new Date() } });
      return { note: deliveryNote(results), undo: [{ kind: 'update', model: 'gallery', id: g.id, data: { remindedAt: g.remindedAt } }] };
    },
  },
  resolve_exception: {
    area: 'Orders', risk: 'internal',
    label: async (t, a) => {
      const x = await db.orderException.findFirst({ where: { id: a.id, tenantId: t } });
      return `Mark resolved: ${x ? `${x.kind.toLowerCase()} · ${x.subject}` : 'exception'}`;
    },
    run: async (c, a) => {
      const x = need(await db.orderException.findFirst({ where: { id: a.id, tenantId: c.tenantId } }), 'Exception');
      await db.orderException.update({ where: { id: x.id }, data: { resolvedAt: new Date() } });
      return { note: 'Marked resolved', undo: [{ kind: 'update', model: 'orderException', id: x.id, data: { resolvedAt: null } }] };
    },
  },
  draft_reply: {
    area: 'Support', risk: 'internal',
    label: async (t, a) => `Draft a reply to "${(await db.ticket.findFirst({ where: { id: a.id, tenantId: t } }))?.subject ?? 'ticket'}"`,
    run: async (c, a) => {
      const k = need(await db.ticket.findFirst({ where: { id: a.id, tenantId: c.tenantId }, include: { school: true } }), 'Ticket');
      const { draftTicketReply } = await import('./operator');
      const draft = await draftTicketReply(c.tenantId, k);
      await db.ticket.update({ where: { id: k.id }, data: { draft } });
      return { note: 'Draft ready for review', undo: [{ kind: 'update', model: 'ticket', id: k.id, data: { draft: k.draft } }] };
    },
  },
  reply_ticket: {
    area: 'Support', risk: 'outbound',
    label: async (t, a) => `Send reply: ${(await db.ticket.findFirst({ where: { id: a.id, tenantId: t } }))?.subject ?? 'ticket'}`,
    run: async (c, a) => {
      const k = need(await db.ticket.findFirst({ where: { id: a.id, tenantId: c.tenantId } }), 'Ticket');
      if (!k.draft.trim()) throw new Error('There is no reply drafted for this ticket');
      const sent = await deliver(c.tenantId, c.runId, k.fromEmail, `Re: ${k.subject}`, k.draft);
      await db.ticket.update({ where: { id: k.id }, data: { status: 'resolved' } });
      return { note: `Resolved. Reply: ${deliveryNote([sent])}`, undo: [{ kind: 'update', model: 'ticket', id: k.id, data: { status: k.status } }] };
    },
  },
  send_invoice: {
    area: 'Accounting', risk: 'outbound',
    label: async (t, a) => {
      const i = await db.invoice.findFirst({ where: { id: a.id, tenantId: t }, include: { school: true } });
      return i ? `Send ${money(i.amountCents)} invoice to ${i.school.name}` : 'Send invoice';
    },
    run: async (c, a) => {
      const i = need(await db.invoice.findFirst({ where: { id: a.id, tenantId: c.tenantId }, include: { school: true } }), 'Invoice');
      const dueOn = i.dueOn ?? addDays(today(), 30);
      const sent = await deliver(c.tenantId, c.runId, i.school.contactEmail, `Invoice: ${i.description}`, `Hello ${i.school.contactName || ''},\n\nInvoice for ${i.description}: ${money(i.amountCents)}, due ${dayLabel(dueOn)}.\n`);
      await db.invoice.update({ where: { id: i.id }, data: { status: 'sent', dueOn } });
      return { note: `Invoice: ${deliveryNote([sent])}`, undo: [{ kind: 'update', model: 'invoice', id: i.id, data: { status: i.status, dueOn: i.dueOn } }] };
    },
  },
  chase_invoice: {
    area: 'Accounting', risk: 'outbound',
    label: async (t, a) => {
      const i = await db.invoice.findFirst({ where: { id: a.id, tenantId: t }, include: { school: true } });
      return i ? `Send payment reminder to ${i.school.name} (${money(i.amountCents)})` : 'Send payment reminder';
    },
    run: async (c, a) => {
      const i = need(await db.invoice.findFirst({ where: { id: a.id, tenantId: c.tenantId }, include: { school: true } }), 'Invoice');
      const sent = await deliver(c.tenantId, c.runId, i.school.contactEmail, `Reminder: ${i.description}`, `Hello ${i.school.contactName || ''},\n\nA reminder that ${money(i.amountCents)} for ${i.description} was due ${i.dueOn ? dayLabel(i.dueOn) : 'recently'}.\n`);
      await db.invoice.update({ where: { id: i.id }, data: { remindedAt: new Date() } });
      return { note: `Reminder: ${deliveryNote([sent])}`, undo: [{ kind: 'update', model: 'invoice', id: i.id, data: { remindedAt: i.remindedAt } }] };
    },
  },
  mark_paid: {
    area: 'Accounting', risk: 'internal',
    label: async (t, a) => {
      const i = await db.invoice.findFirst({ where: { id: a.id, tenantId: t }, include: { school: true } });
      return i ? `Record ${money(i.amountCents)} from ${i.school.name} as paid` : 'Record payment';
    },
    run: async (c, a) => {
      const i = need(await db.invoice.findFirst({ where: { id: a.id, tenantId: c.tenantId } }), 'Invoice');
      await db.invoice.update({ where: { id: i.id }, data: { status: 'paid', paidOn: today() } });
      return { note: 'Recorded as paid', undo: [{ kind: 'update', model: 'invoice', id: i.id, data: { status: i.status, paidOn: i.paidOn } }] };
    },
  },
  advance_deal: {
    area: 'Sales', risk: 'internal',
    label: async (t, a) => {
      const d = await db.deal.findFirst({ where: { id: a.id, tenantId: t } });
      return d ? `Move ${d.name} to ${STAGES[Math.min(4, STAGES.indexOf(d.stage) + 1)]}` : 'Advance deal';
    },
    run: async (c, a) => {
      const d = need(await db.deal.findFirst({ where: { id: a.id, tenantId: c.tenantId } }), 'Deal');
      const stage = STAGES[Math.min(4, STAGES.indexOf(d.stage) + 1)];
      await db.deal.update({ where: { id: d.id }, data: { stage, lastTouch: new Date() } });
      return { note: `Now in ${stage}`, undo: [{ kind: 'update', model: 'deal', id: d.id, data: { stage: d.stage, lastTouch: d.lastTouch } }] };
    },
  },
  send_followup: {
    area: 'Sales', risk: 'outbound',
    label: async (t, a) => `Send a follow-up email to ${(await db.deal.findFirst({ where: { id: a.id, tenantId: t } }))?.name ?? 'the prospect'}`,
    run: async (c, a) => {
      const d = need(await db.deal.findFirst({ where: { id: a.id, tenantId: c.tenantId } }), 'Deal');
      const sent = await deliver(c.tenantId, c.runId, d.contactEmail, `Following up: ${d.name}`, a.value?.trim() || `Hello,\n\nFollowing up on our conversation about ${d.detail || 'picture day'}. Is there anything I can answer to help you decide?\n`);
      await db.deal.update({ where: { id: d.id }, data: { lastTouch: new Date() } });
      return { note: `Follow-up: ${deliveryNote([sent])}`, undo: [{ kind: 'update', model: 'deal', id: d.id, data: { lastTouch: d.lastTouch } }] };
    },
  },
  set_autonomy: {
    area: 'Settings', risk: 'internal',
    label: async (_t, a) => `Set ${a.id} to "${a.value}"`,
    run: async (c, a) => {
      if (!['Scheduling', 'Sales', 'Contracts', 'Orders', 'Support', 'Accounting'].includes(a.id ?? '') || !['suggest', 'ask', 'auto'].includes(a.value ?? '')) throw new Error('Unknown area or level');
      const t = await db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } });
      const cur = (t.autonomy ?? {}) as Record<string, string>;
      await db.tenant.update({ where: { id: t.id }, data: { autonomy: { ...cur, [a.id!]: a.value! } } });
      return { note: 'Saved', undo: [{ kind: 'update', model: 'tenant', id: t.id, data: { autonomy: cur } }] };
    },
  },
  toggle_rule: {
    area: 'Settings', risk: 'internal',
    label: async (_t, a) => `Turn ${a.value === 'on' ? 'on' : 'off'}: ${RULES[a.id ?? '']?.name ?? 'automation'}`,
    run: async (c, a) => {
      if (!RULES[a.id ?? '']) throw new Error('Unknown automation');
      const t = await db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } });
      const off = new Set(t.rulesOff);
      if (a.value === 'on') off.delete(a.id!); else off.add(a.id!);
      await db.tenant.update({ where: { id: t.id }, data: { rulesOff: [...off] } });
      return { note: a.value === 'on' ? 'Now running' : 'Paused', undo: [{ kind: 'update', model: 'tenant', id: t.id, data: { rulesOff: t.rulesOff } }] };
    },
  },
};

export type Step = { action: Action; label: string; area: Area; needsOK: boolean; ok?: boolean; note?: string };

export function needsOK(op: Op, autonomy: Record<string, string>): boolean {
  const lvl = autonomy[op.area] ?? 'ask';
  if (lvl === 'auto') return false;
  return lvl === 'suggest' ? true : op.risk === 'outbound';
}

/** Turns raw actions into labelled steps. Unknown operations are dropped. */
export async function describe(tenantId: string, autonomy: Record<string, string>, actions: Action[]): Promise<Step[]> {
  const steps: Step[] = [];
  for (const a of actions.slice(0, 40)) {
    const op = OPS[a.op];
    if (!op) continue;
    steps.push({ action: { op: a.op, id: a.id, id2: a.id2, value: a.value }, label: await op.label(tenantId, a), area: op.area, needsOK: needsOK(op, autonomy) });
  }
  return steps;
}

export async function execute(who: { tenantId: string; role: Role; actor: string; rulesOff: string[] }, actions: Action[]): Promise<{ runId: string; steps: Step[] }> {
  const runId = randomUUID();
  const c: RunCtx = { tenantId: who.tenantId, runId, rulesOff: who.rulesOff };
  const steps = await describe(who.tenantId, {}, actions);
  for (const s of steps) {
    const op = OPS[s.action.op];
    try {
      if (!canAct(who.role, op.area)) throw new Error(`Your role cannot change ${op.area.toLowerCase()}`);
      const r = await op.run(c, s.action);
      s.ok = true;
      s.note = r.note;
      await db.auditLog.create({ data: { tenantId: who.tenantId, runId, actor: who.actor, op: s.action.op, label: s.label, note: r.note, undo: (r.undo ?? []) as object } });
    } catch (e) {
      s.ok = false;
      s.note = e instanceof Error ? e.message : 'Failed';
    }
  }
  return { runId, steps };
}

/** Reverses the database changes of one run. Emails that were actually sent cannot be recalled. */
export async function undoRun(tenantId: string, runId: string): Promise<string> {
  const logs = await db.auditLog.findMany({ where: { tenantId, runId, undone: false }, orderBy: { createdAt: 'desc' } });
  if (!logs.length) return 'Nothing to undo';
  const models = db as unknown as Record<string, { updateMany: (a: object) => Promise<unknown>; deleteMany: (a: object) => Promise<unknown> }>;
  for (const l of logs) {
    for (const u of ((l.undo ?? []) as Undo[]).slice().reverse()) {
      if (u.kind === 'update') await (u.model === 'tenant' ? db.tenant.updateMany({ where: { id: tenantId }, data: u.data }) : models[u.model].updateMany({ where: { id: u.id, tenantId }, data: u.data }));
      else await models[u.model].deleteMany({ where: { id: { in: u.ids }, tenantId } });
    }
    await db.auditLog.update({ where: { id: l.id }, data: { undone: true } });
  }
  const sent = await db.outbox.count({ where: { tenantId, runId, status: 'sent' } });
  await db.outbox.deleteMany({ where: { tenantId, runId, status: { not: 'sent' } } });
  return sent ? `Undone. ${sent} ${sent === 1 ? 'email was' : 'emails were'} already sent and cannot be recalled` : 'Undone';
}

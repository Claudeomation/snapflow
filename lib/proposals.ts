import { db } from './db';
import { suggestPhotographer, type Action } from './ops';
import { addDays, dayLabel, daysBetween, money, pct, today } from './format';
import type { Area } from './roles';

export type Proposal = { key: string; rule: string; area: Area; title: string; why: string; actions: Action[] };

/**
 * The approval queue is derived from live data every time, so it is never stale.
 * Dismissing a proposal stores its key; a rule switched off produces nothing.
 */
export async function proposals(tenantId: string, rulesOff: string[]): Promise<Proposal[]> {
  const t = today();
  const on = (r: string) => !rulesOff.includes(r);
  const out: Proposal[] = [];

  if (on('staffing')) {
    const open = await db.shoot.findMany({ where: { tenantId, photographerId: null, date: { gte: t, lte: addDays(t, 14) } }, include: { school: true }, orderBy: { date: 'asc' } });
    const booked = new Set<string>();
    for (const s of open) {
      const pick = await suggestPhotographer(tenantId, s, booked);
      if (!pick) continue;
      booked.add(`${pick.id}:${s.date.toISOString().slice(0, 10)}`);
      out.push({ key: `staff:${s.id}:${pick.id}`, rule: 'staffing', area: 'Scheduling', title: `Assign ${pick.name} to ${s.school.name} ${s.type.toLowerCase()}`, why: `${dayLabel(s.date)}. ${pick.name}: ${pick.why}.`, actions: [{ op: 'assign', id: s.id, id2: pick.id }] });
    }
  }

  if (on('gallery_reminder')) {
    const gs = await db.gallery.findMany({ where: { tenantId, closesOn: { gte: t, lte: addDays(t, 7) } }, include: { school: true, entries: { select: { status: true } } } });
    for (const g of gs) {
      const none = g.entries.filter((e) => e.status === 'none').length;
      const part = pct(g.entries.length - none, g.entries.length);
      const recently = g.remindedAt && daysBetween(g.remindedAt, new Date()) < 3;
      if (!none || recently || part >= (g.lastYearPart ?? 50)) continue;
      out.push({ key: `remind:${g.id}:${g.remindedAt?.toISOString().slice(0, 10) ?? '0'}`, rule: 'gallery_reminder', area: 'Orders', title: `Remind ${none} ${g.school.name} families who have not ordered`, why: `${g.name} closes in ${daysBetween(t, g.closesOn)} days. Participation is ${part}%${g.lastYearPart ? ` against ${g.lastYearPart}% last year` : ''}.`, actions: [{ op: 'send_reminder', id: g.id }] });
    }
  }

  if (on('ticket_reply')) {
    const ts = await db.ticket.findMany({ where: { tenantId, status: 'open', priority: { not: 'High' }, NOT: { draft: '' } }, orderBy: { dueAt: 'asc' } });
    if (ts.length) out.push({ key: `tickets:${ts.map((x) => x.id).join(',')}`, rule: 'ticket_reply', area: 'Support', title: `Send ${ts.length} drafted ${ts.length === 1 ? 'reply' : 'replies'}`, why: `${ts.map((x) => `"${x.subject}"`).slice(0, 3).join(', ')}${ts.length > 3 ? ' and more' : ''}. High-priority tickets are left for you.`, actions: ts.map((x) => ({ op: 'reply_ticket', id: x.id })) });
  }

  if (on('invoice_chase')) {
    const inv = (await db.invoice.findMany({ where: { tenantId, status: 'sent', dueOn: { lt: t } }, include: { school: true } })).filter((i) => !i.remindedAt || daysBetween(i.remindedAt, new Date()) >= 7);
    if (inv.length) out.push({ key: `chase:${inv.map((i) => i.id).join(',')}`, rule: 'invoice_chase', area: 'Accounting', title: `Chase ${inv.length} overdue ${inv.length === 1 ? 'invoice' : 'invoices'} worth ${money(inv.reduce((s, i) => s + i.amountCents, 0))}`, why: inv.map((i) => `${i.school.name} is ${daysBetween(i.dueOn!, t)} days late`).join('. ') + '.', actions: inv.map((i) => ({ op: 'chase_invoice', id: i.id })) });
  }

  if (on('renewal')) {
    const ending = await db.contract.findMany({ where: { tenantId, status: 'signed', termEnds: { gte: t, lte: addDays(t, 60) } }, include: { school: { include: { contracts: true } } } });
    for (const k of ending) {
      const next = k.school.contracts.find((o) => o.id !== k.id && o.status !== 'signed');
      if (!next) out.push({ key: `renew:${k.id}`, rule: 'renewal', area: 'Contracts', title: `Draft the ${k.school.name} renewal`, why: `The current term ends in ${daysBetween(t, k.termEnds!)} days and no renewal exists yet.`, actions: [{ op: 'draft_renewal', id: k.id }] });
      else if (next.status === 'draft') out.push({ key: `sendrenew:${next.id}`, rule: 'renewal', area: 'Contracts', title: `Send the ${k.school.name} renewal`, why: `The current term ends in ${daysBetween(t, k.termEnds!)} days. The draft is ready.`, actions: [{ op: 'send_contract', id: next.id }] });
    }
  }

  const dismissed = new Set((await db.dismissal.findMany({ where: { tenantId }, select: { key: true } })).map((d) => d.key));
  return out.filter((p) => !dismissed.has(p.key));
}

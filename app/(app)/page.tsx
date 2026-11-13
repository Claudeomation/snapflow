import Link from 'next/link';
import { Empty, Head, Pill, Section } from '@/components/bits';
import { AskButton, DismissButton, OpButton } from '@/components/ui';
import { db } from '@/lib/db';
import { page } from '@/lib/guard';
import { proposals } from '@/lib/proposals';
import { addDays, daysBetween, money, pct, today } from '@/lib/format';
import { canAct, canOpen } from '@/lib/roles';

const STATUS: Record<string, string> = { scheduled: 'Scheduled', briefed: 'Briefing sent', onsite: 'On site', complete: 'Complete' };

export default async function Briefing() {
  const c = await page('/');
  const t = today();
  const tenantId = c.tenantId;
  const season = new Date(Date.UTC(t.getUTCMonth() >= 6 ? t.getUTCFullYear() : t.getUTCFullYear() - 1, 6, 1));
  const [queueAll, shoots, openShoots, tickets, paid, galleries, ending, recent] = await Promise.all([
    proposals(tenantId, c.tenant.rulesOff),
    db.shoot.findMany({ where: { tenantId, date: t }, include: { school: true, photographer: true } }),
    db.shoot.count({ where: { tenantId, photographerId: null, date: { gte: t } } }),
    db.ticket.findMany({ where: { tenantId, status: 'open' }, orderBy: { dueAt: 'asc' } }),
    db.invoice.aggregate({ where: { tenantId, status: 'paid', paidOn: { gte: season } }, _sum: { amountCents: true } }),
    db.gallery.findMany({ where: { tenantId, closesOn: { gte: t } }, include: { school: true, entries: { select: { status: true } } } }),
    db.contract.findMany({ where: { tenantId, status: 'signed', termEnds: { gte: t, lte: addDays(t, 60) } }, include: { school: true } }),
    db.auditLog.findMany({ where: { tenantId, undone: false, createdAt: { gte: new Date(Date.now() - 86400000) } }, orderBy: { createdAt: 'desc' }, take: 6 }),
  ]);
  const queue = queueAll.filter((p) => canAct(c.role, p.area));
  const entries = galleries.flatMap((g) => g.entries);
  const part = pct(entries.filter((e) => e.status !== 'none').length, entries.length);
  const urgent = tickets.filter((k) => k.dueAt.getTime() - Date.now() < 2 * 3600000);
  const risks: [string, string, string][] = [];
  for (const g of galleries) {
    const p = pct(g.entries.filter((e) => e.status !== 'none').length, g.entries.length);
    if (g.lastYearPart != null && p < g.lastYearPart - 5) risks.push([`${g.school.name} participation is ${p}%`, `Last year it was ${g.lastYearPart}%. ${g.name} closes in ${daysBetween(t, g.closesOn)} days.`, '/orders']);
  }
  for (const k of urgent) risks.push([`Ticket due soon: ${k.subject}`, k.fromName, '/support']);
  for (const k of ending) risks.push([`${k.school.name} contract ends in ${daysBetween(t, k.termEnds!)} days`, k.title, '/contracts']);
  const hr = new Date().getHours();
  return (
    <>
      <Head title={`Good ${hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening'}, ${c.user.name.split(' ')[0]}.`} sub={`${shoots.length} ${shoots.length === 1 ? 'shoot' : 'shoots'} today, ${queue.length} ${queue.length === 1 ? 'thing needs' : 'things need'} your OK, ${risks.length} at risk.`}>
        <AskButton q="What needs my attention today?">Walk me through it</AskButton>
      </Head>
      <div className="kpis">
        <div className="card kpi"><span className="label">Collected this season</span><b>{money(paid._sum.amountCents ?? 0)}</b><span className="muted">paid invoices since July 1</span></div>
        <div className="card kpi"><span className="label">Participation</span><b>{entries.length ? `${part}%` : 'n/a'}</b><span className="muted">across {galleries.length} open {galleries.length === 1 ? 'gallery' : 'galleries'}</span></div>
        <div className="card kpi"><span className="label">Open shoots</span><b>{openShoots}</b><span className="muted">{openShoots ? 'need a photographer' : 'every shoot is staffed'}</span></div>
        <div className="card kpi"><span className="label">Open tickets</span><b>{tickets.length}</b><span className="muted">{urgent.length} due within 2 hours</span></div>
      </div>
      <div className="grid2">
        <div className="stack">
          <Section title="Needs your OK" sub="Prepared and ready. Nothing here goes out until you say so." right={queue.length > 1 && <OpButton actions={queue.flatMap((p) => p.actions)} title={`Approve all ${queue.length}`}>Approve all {queue.length}</OpButton>}>
            {queue.map((p) => (
              <div className="item" key={p.key}>
                <div className="body"><Pill tone="ai">{p.area}</Pill> <b>{p.title}</b><small>{p.why}</small></div>
                <div className="acts"><OpButton actions={p.actions} title={`Approve: ${p.title}`} className="btn sm primary">Approve</OpButton><DismissButton k={p.key} /></div>
              </div>
            ))}
            {!queue.length && <Empty>The queue is clear. Proposals appear here as shoots, galleries, tickets, invoices and contracts need attention.</Empty>}
          </Section>
          <Section title="At risk">
            {risks.map((r, i) => (
              <div className="item" key={i}><div className="body"><b>{r[0]}</b><small>{r[1]}</small></div>{canOpen(c.role, r[2]) && <div className="acts"><Link className="btn sm" href={r[2]}>Open</Link></div>}</div>
            ))}
            {!risks.length && <Empty>Nothing is trending the wrong way.</Empty>}
          </Section>
        </div>
        <div className="stack">
          <Section title="Today's shoots">
            {shoots.map((s) => (
              <div className="item" key={s.id}><div className="body"><b>{s.school.name}</b><small>{s.type} · {s.students} students · {s.photographer?.name ?? 'Unassigned'}</small></div><Pill tone={s.status === 'complete' || s.status === 'onsite' ? 'ok' : ''}>{STATUS[s.status] ?? s.status}</Pill></div>
            ))}
            {!shoots.length && <Empty>No shoots today.</Empty>}
          </Section>
          <Section title="Done in the last 24 hours">
            {recent.map((l) => <div className="item" key={l.id}><div className="body"><b>{l.label}</b><small>{l.note} · {l.actor}</small></div></div>)}
            {!recent.length && <Empty>Nothing yet. Approve an item or ask the operator for something.</Empty>}
          </Section>
        </div>
      </div>
    </>
  );
}

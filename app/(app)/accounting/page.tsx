import { Bar, Empty, Head, Insight, Pill } from '@/components/bits';
import { AskButton, NewRecord, OpButton } from '@/components/ui';
import { db } from '@/lib/db';
import { page } from '@/lib/guard';
import { dayLabel, daysBetween, money, today } from '@/lib/format';

export default async function Accounting() {
  const c = await page('/accounting');
  const t = today();
  const tenantId = c.tenantId;
  const season = new Date(Date.UTC(t.getUTCMonth() >= 6 ? t.getUTCFullYear() : t.getUTCFullYear() - 1, 6, 1));
  const [invoices, schools] = await Promise.all([
    db.invoice.findMany({ where: { tenantId, issuedOn: { gte: season } }, include: { school: true }, orderBy: { issuedOn: 'desc' } }),
    db.school.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
  ]);
  const late = (i: { status: string; dueOn: Date | null }) => i.status === 'sent' && !!i.dueOn && i.dueOn < t;
  const overdue = invoices.filter(late);
  const bySchool = new Map<string, { paid: number; owed: number }>();
  for (const i of invoices) { const r = bySchool.get(i.school.name) ?? { paid: 0, owed: 0 }; if (i.status === 'paid') r.paid += i.amountCents; else if (i.status === 'sent') r.owed += i.amountCents; bySchool.set(i.school.name, r); }
  const top = [...bySchool.entries()].sort((a, b) => b[1].paid + b[1].owed - (a[1].paid + a[1].owed)).slice(0, 8);
  const max = Math.max(1, ...top.map(([, r]) => r.paid + r.owed));
  return (
    <>
      <Head title="Accounting" sub="Invoices and what each school has paid this season.">
        {schools.length > 0 && <NewRecord kind="invoice" title="New invoice" fields={[{ name: 'schoolId', label: 'School', type: 'select', options: schools.map((s) => [s.id, s.name]), required: true }, { name: 'description', label: 'For', required: true }, { name: 'amount', label: 'Amount ($)', type: 'number', required: true }]} />}
      </Head>
      <Insight action={overdue.length ? <AskButton q="Chase overdue invoices">Chase them</AskButton> : undefined}>{overdue.length ? `${overdue.length} ${overdue.length === 1 ? 'invoice is' : 'invoices are'} overdue for ${money(overdue.reduce((s, i) => s + i.amountCents, 0))}.` : 'Nothing is overdue.'} QuickBooks sync is not connected; this ledger is SnapFlow's own.</Insight>
      <div className="card flush"><div className="tablebox"><table>
        <thead><tr><th>Invoice</th><th>School</th><th className="r">Amount</th><th>Status</th><th>Due</th><th /></tr></thead>
        <tbody>{invoices.map((i) => (
          <tr key={i.id}>
            <td><b>{i.description}</b></td><td className="muted">{i.school.name}</td><td className="r num">{money(i.amountCents)}</td>
            <td>{i.status === 'paid' ? <Pill tone="ok">Paid</Pill> : late(i) ? <Pill tone="bad">Overdue {daysBetween(i.dueOn!, t)} days</Pill> : <Pill>{i.status === 'sent' ? 'Sent' : 'Draft'}</Pill>}</td>
            <td className="muted">{i.status === 'paid' ? `paid ${dayLabel(i.paidOn!)}` : i.dueOn ? dayLabel(i.dueOn) : ''}</td>
            <td><div className="row">
              {i.status === 'draft' && <OpButton actions={[{ op: 'send_invoice', id: i.id }]} title={`Send invoice to ${i.school.name}`} className="btn sm primary">Send</OpButton>}
              {late(i) && <OpButton actions={[{ op: 'chase_invoice', id: i.id }]} title={`Remind ${i.school.name}`}>{i.remindedAt ? 'Remind again' : 'Send reminder'}</OpButton>}
              {i.status === 'sent' && <OpButton actions={[{ op: 'mark_paid', id: i.id }]} title={`Record payment from ${i.school.name}`}>Record payment</OpButton>}
            </div></td>
          </tr>
        ))}</tbody>
      </table></div>{!invoices.length && <Empty>No invoices this season.</Empty>}</div>
      {top.length > 0 && (
        <div className="card"><span className="label">Billed by school this season</span><div className="stack">
          {top.map(([name, r]) => <div key={name}><div className="row" style={{ justifyContent: 'space-between' }}><span>{name}</span><span className="num muted">{money(r.paid)} paid{r.owed ? ` · ${money(r.owed)} owed` : ''}</span></div><Bar value={((r.paid + r.owed) / max) * 100} tone={r.owed ? 'warn' : 'ok'} /></div>)}
        </div></div>
      )}
    </>
  );
}

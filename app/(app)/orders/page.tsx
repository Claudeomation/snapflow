import { Bar, Empty, Head, Insight, Pill, Section } from '@/components/bits';
import { NewRecord, OpButton } from '@/components/ui';
import { db } from '@/lib/db';
import { page } from '@/lib/guard';
import { dayLabel, daysBetween, money, pct, today } from '@/lib/format';

export default async function Orders() {
  const c = await page('/orders');
  const t = today();
  const tenantId = c.tenantId;
  const [galleries, exceptions, schools] = await Promise.all([
    db.gallery.findMany({ where: { tenantId }, include: { school: true, entries: { select: { status: true, viewedAt: true, amountCents: true } } }, orderBy: { closesOn: 'asc' } }),
    db.orderException.findMany({ where: { tenantId, resolvedAt: null }, include: { gallery: { include: { school: true } } } }),
    db.school.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
  ]);
  const rows = galleries.map((g) => { const n = (s: string) => g.entries.filter((e) => e.status === s).length; const ordered = g.entries.length - n('none'); return { g, total: g.entries.length, viewed: g.entries.filter((e) => e.viewedAt).length, ordered, lab: n('lab'), shipped: n('shipped'), none: n('none'), part: pct(ordered, g.entries.length), sales: g.entries.reduce((s, e) => s + e.amountCents, 0), closes: daysBetween(t, g.closesOn) }; });
  const worst = rows.filter((r) => r.closes >= 0 && r.g.lastYearPart != null && r.none > 0).sort((a, b) => (a.part - a.g.lastYearPart!) - (b.part - b.g.lastYearPart!))[0];
  return (
    <>
      <Head title="Orders" sub="Every student in every gallery, from proof to doorstep.">
        {schools.length > 0 && <NewRecord kind="gallery" title="Open a gallery" fields={[{ name: 'schoolId', label: 'School', type: 'select', options: schools.map((s) => [s.id, s.name]), required: true }, { name: 'name', label: 'Gallery name', required: true, placeholder: 'Fall portraits' }, { name: 'closesOn', label: 'Ordering closes', type: 'date', required: true }, { name: 'lastYearPart', label: 'Last year participation (%)', type: 'number' }]} />}
        <NewRecord kind="exception" title="Log an exception" fields={[{ name: 'kind', label: 'Kind', required: true, placeholder: 'Missing image' }, { name: 'subject', label: 'What is affected', required: true }, { name: 'fix', label: 'How to fix it', type: 'textarea' }]} />
      </Head>
      {worst && worst.part < worst.g.lastYearPart! ? <Insight action={<OpButton actions={[{ op: 'send_reminder', id: worst.g.id }]} title={`Remind ${worst.g.school.name} families`} className="btn sm primary">Remind them</OpButton>}>{worst.g.school.name} is {worst.g.lastYearPart! - worst.part} points behind last year with {worst.closes} days left. {worst.none} families have not ordered.</Insight>
        : <Insight>{rows.length ? 'No open gallery is behind last year.' : 'No galleries yet. Opening one gives every student on the roster an access code.'} Order status is entered here or imported; a live storefront sync is not connected.</Insight>}
      <div className="card flush"><div className="tablebox"><table>
        <thead><tr><th>Gallery</th><th className="r">Students</th><th className="r">Viewed</th><th className="r">Ordered</th><th>Participation</th><th className="r">At lab</th><th className="r">Shipped</th><th className="r">Sales</th><th>Closes</th><th /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.g.id}>
            <td><b>{r.g.school.name}</b><br /><span className="muted">{r.g.name}</span></td><td className="r num">{r.total}</td><td className="r num">{r.viewed}</td><td className="r num">{r.ordered}</td>
            <td><div className="row" style={{ flexWrap: 'nowrap' }}><span className="num" style={{ width: 34 }}>{r.part}%</span><Bar value={r.part} tone={r.g.lastYearPart == null ? '' : r.part < r.g.lastYearPart - 5 ? 'bad' : r.part < r.g.lastYearPart ? 'warn' : 'ok'} /></div>{r.g.lastYearPart != null && <span className="faint" style={{ fontSize: 12 }}>last year {r.g.lastYearPart}%</span>}</td>
            <td className="r num">{r.lab}</td><td className="r num">{r.shipped}</td><td className="r num">{money(r.sales)}</td>
            <td>{r.closes < 0 ? <Pill>Closed</Pill> : <Pill tone={r.closes <= 5 ? 'warn' : ''}>{r.closes} days</Pill>}</td>
            <td>{r.closes >= 0 && r.none > 0 && <OpButton actions={[{ op: 'send_reminder', id: r.g.id }]} title={`Remind ${r.g.school.name} families`}>{r.g.remindedAt ? `Remind again (last ${dayLabel(r.g.remindedAt)})` : 'Remind'}</OpButton>}</td>
          </tr>
        ))}</tbody>
      </table></div>{!rows.length && <Empty>No galleries yet.</Empty>}</div>
      <Section title="Exceptions" sub="Orders that cannot move on their own.">
        {exceptions.map((x) => (
          <div className="item" key={x.id}><div className="body"><Pill tone="warn">{x.kind}</Pill> <b>{x.subject}</b><small>{[x.gallery?.school.name, x.fix].filter(Boolean).join(' · ')}</small></div><div className="acts"><OpButton actions={[{ op: 'resolve_exception', id: x.id }]} title={`Resolve: ${x.subject}`} className="btn sm primary">Mark resolved</OpButton></div></div>
        ))}
        {!exceptions.length && <Empty>No open exceptions.</Empty>}
      </Section>
    </>
  );
}

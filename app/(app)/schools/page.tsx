import Link from 'next/link';
import { Bar, Empty, Head, Insight, Pill } from '@/components/bits';
import { NewRecord, RosterImport } from '@/components/ui';
import { db } from '@/lib/db';
import { page } from '@/lib/guard';
import { dayLabel, pct, today } from '@/lib/format';

export default async function Schools({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const c = await page('/schools');
  const { id } = await searchParams;
  const tenantId = c.tenantId;
  const schools = await db.school.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, include: { _count: { select: { students: true } }, galleries: { include: { entries: { select: { status: true } } }, orderBy: { closesOn: 'desc' }, take: 1 } } });
  const rows = schools.map((s) => { const g = s.galleries[0]; return { ...s, part: g ? pct(g.entries.filter((e) => e.status !== 'none').length, g.entries.length) : null, last: g?.lastYearPart ?? null }; });
  const sel = rows.find((s) => s.id === id) ?? rows[0];
  const shoots = sel ? await db.shoot.findMany({ where: { tenantId, schoolId: sel.id, date: { gte: today() } }, include: { photographer: true }, orderBy: { date: 'asc' } }) : [];
  const behind = rows.filter((s) => s.part != null && s.last != null && s.part < s.last).sort((a, b) => (a.part! - a.last!) - (b.part! - b.last!))[0];
  return (
    <>
      <Head title="Schools" sub="One record per school: roster, contact, gear and how the account is doing.">
        <NewRecord kind="school" title="New school" fields={[{ name: 'name', label: 'School name', required: true }, { name: 'district', label: 'District' }, { name: 'zone', label: 'Zone (used to match photographers)' }, { name: 'enrollment', label: 'Enrollment', type: 'number', required: true }, { name: 'contactName', label: 'Contact name' }, { name: 'contactEmail', label: 'Contact email', type: 'email' }, { name: 'gear', label: 'Equipment load-out' }]} />
      </Head>
      {behind ? <Insight><b>{behind.name}</b> is furthest behind last year: {behind.part}% participation against {behind.last}%.</Insight> : <Insight>{rows.length ? 'No school is behind last year on participation.' : 'Add your first school to get started.'}</Insight>}
      <div className="card flush"><div className="tablebox"><table>
        <thead><tr><th>School</th><th>District</th><th className="r">Enrollment</th><th className="r">On roster</th><th>Participation</th></tr></thead>
        <tbody>{rows.map((s) => (
          <tr key={s.id} className={s.id === sel?.id ? 'sel' : ''}>
            <td><Link href={`/schools?id=${s.id}`} style={{ color: 'inherit', fontWeight: 600 }}>{s.name}</Link></td><td className="muted">{s.district}</td><td className="r num">{s.enrollment.toLocaleString()}</td><td className="r num">{s._count.students}</td>
            <td>{s.part == null ? <span className="faint">No gallery yet</span> : <div className="row" style={{ flexWrap: 'nowrap' }}><span className="num" style={{ width: 34 }}>{s.part}%</span><Bar value={s.part} tone={s.last != null && s.part < s.last - 5 ? 'bad' : s.last != null && s.part < s.last ? 'warn' : 'ok'} /></div>}</td>
          </tr>
        ))}</tbody>
      </table></div>{!rows.length && <Empty>No schools yet.</Empty>}</div>
      {sel && (
        <div className="card">
          <div className="sechead"><h2>{sel.name}</h2><div className="row">{sel.zone && <Pill>{sel.zone} zone</Pill>}<RosterImport schoolId={sel.id} /></div></div>
          <div className="grid2 even">
            <div className="stack" style={{ gap: 6 }}><span className="label">Contact</span><span>{sel.contactName || 'Not set'}{sel.contactEmail && ` · ${sel.contactEmail}`}</span><span className="label" style={{ marginTop: 8 }}>Roster</span><span>{sel._count.students} students on file ({sel.rosterSource})</span><span className="label" style={{ marginTop: 8 }}>Equipment load-out</span><span>{sel.gear || 'Not set'}</span></div>
            <div className="stack" style={{ gap: 6 }}><span className="label">Coming up</span>{shoots.map((e) => <span key={e.id}>{dayLabel(e.date)} · {e.type} · {e.photographer?.name ?? 'Unassigned'}</span>)}{!shoots.length && <span className="muted">Nothing scheduled</span>}</div>
          </div>
        </div>
      )}
    </>
  );
}

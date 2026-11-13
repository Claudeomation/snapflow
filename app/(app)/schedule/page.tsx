import { Bar, Empty, Head, Insight, Pill } from '@/components/bits';
import { NewRecord, OpButton } from '@/components/ui';
import { db } from '@/lib/db';
import { page } from '@/lib/guard';
import { suggestPhotographer } from '@/lib/ops';
import { addDays, dayKey, dayLabel, today } from '@/lib/format';

const STATUS: Record<string, string> = { scheduled: 'Scheduled', briefed: 'Briefing sent', onsite: 'On site', complete: 'Complete' };
const NEXT: Record<string, [string, string] | undefined> = { briefed: ['onsite', 'Check in'], scheduled: ['onsite', 'Check in'], onsite: ['complete', 'Complete'] };

export default async function Schedule() {
  const c = await page('/schedule');
  const t = today();
  const tenantId = c.tenantId;
  const [shoots, crew, schools] = await Promise.all([
    db.shoot.findMany({ where: { tenantId, date: { gte: t, lte: addDays(t, 30) } }, include: { school: true, photographer: true }, orderBy: [{ date: 'asc' }, { schoolId: 'asc' }] }),
    db.photographer.findMany({ where: { tenantId }, include: { _count: { select: { shoots: { where: { date: { gte: t } } } } } }, orderBy: { name: 'asc' } }),
    db.school.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
  ]);
  const open = shoots.filter((s) => !s.photographerId);
  const booked = new Set<string>();
  const picks = new Map<string, { id: string; name: string; why: string }>();
  for (const s of open) { const p = await suggestPhotographer(tenantId, s, booked); if (p) { picks.set(s.id, p); booked.add(`${p.id}:${dayKey(s.date)}`); } }
  const days = [...new Set(shoots.map((s) => dayKey(s.date)))];
  return (
    <>
      <Head title="Schedule" sub="Crew assignment by zone, availability and workload. A briefing goes to the photographer when a shoot is staffed.">
        {open.length > 0 && <OpButton actions={[{ op: 'auto_schedule' }]} title="Assign all open shoots" className="btn primary">Assign all {open.length} open</OpButton>}
        {schools.length > 0 && <NewRecord kind="shoot" title="New shoot" fields={[{ name: 'schoolId', label: 'School', type: 'select', options: schools.map((s) => [s.id, s.name]), required: true }, { name: 'type', label: 'Type', required: true, placeholder: 'Fall portraits' }, { name: 'date', label: 'Date', type: 'date', required: true }, { name: 'students', label: 'Students expected', type: 'number', required: true }]} />}
        <NewRecord kind="photographer" title="New photographer" fields={[{ name: 'name', label: 'Name', required: true }, { name: 'email', label: 'Email', type: 'email' }, { name: 'zone', label: 'Zone' }, { name: 'payType', label: 'Pay type', type: 'select', options: [['Hourly', 'Hourly'], ['Day rate', 'Day rate'], ['Salary', 'Salary']] }]} />
      </Head>
      <Insight>{open.length ? `${open.length} ${open.length === 1 ? 'shoot has' : 'shoots have'} no photographer. A pick is shown for each, with the reason.` : shoots.length ? 'Every shoot in the next 30 days is staffed.' : 'No shoots in the next 30 days.'}</Insight>
      <div className="grid2">
        <div className="stack">
          {days.map((d) => (
            <div className="card flush" key={d}>
              <div className="item"><div className="body"><h3>{dayLabel(new Date(`${d}T00:00:00Z`))}</h3></div></div>
              {shoots.filter((s) => dayKey(s.date) === d).map((s) => {
                const pick = picks.get(s.id);
                const next = NEXT[s.status];
                return (
                  <div className="item" key={s.id}>
                    <div className="body"><b>{s.school.name}</b><small>{s.type} · {s.students} students</small>{pick && <small><span className="pill ai">Pick</span> {pick.name}: {pick.why}</small>}</div>
                    <div className="acts">
                      {s.photographer ? <><Pill>{s.photographer.name}</Pill><Pill tone={s.status === 'complete' || s.status === 'onsite' ? 'ok' : ''}>{STATUS[s.status]}</Pill>{next && d === dayKey(t) && <OpButton actions={[{ op: 'shoot_status', id: s.id, value: next[0] }]} title={`${next[1]}: ${s.school.name}`}>{next[1]}</OpButton>}</>
                        : pick ? <OpButton actions={[{ op: 'assign', id: s.id, id2: pick.id }]} title={`Assign ${pick.name} to ${s.school.name}`} className="btn sm primary">Assign {pick.name}</OpButton> : <Pill tone="bad">No one free</Pill>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {!shoots.length && <div className="card"><Empty>Add a shoot to start scheduling.</Empty></div>}
        </div>
        <div className="card">
          <span className="label">Crew, upcoming shoots</span>
          <div className="stack">
            {crew.map((p) => (
              <div key={p.id}><div className="row" style={{ justifyContent: 'space-between' }}><b>{p.name}</b><span className="muted num">{p._count.shoots}</span></div><div className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}>{[p.zone && `${p.zone} zone`, p.payType, p.daysOff.filter((x) => x >= t).length ? `off ${p.daysOff.filter((x) => x >= t).map(dayLabel).join(', ')}` : ''].filter(Boolean).join(' · ')}</div><Bar value={p._count.shoots * 20} /></div>
            ))}
            {!crew.length && <span className="muted">No photographers yet.</span>}
          </div>
        </div>
      </div>
    </>
  );
}

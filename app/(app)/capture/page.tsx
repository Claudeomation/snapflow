import Link from 'next/link';
import { Empty, Head, Insight, Pill } from '@/components/bits';
import { CaptureControls } from '@/components/ui';
import { db } from '@/lib/db';
import { page } from '@/lib/guard';
import { addDays, dayLabel, today } from '@/lib/format';

export default async function Capture({ searchParams }: { searchParams: Promise<{ shoot?: string; student?: string }> }) {
  const c = await page('/capture');
  const q = await searchParams;
  const t = today();
  const tenantId = c.tenantId;
  const shoots = await db.shoot.findMany({ where: { tenantId, date: { gte: addDays(t, -1), lte: addDays(t, 7) } }, include: { school: true }, orderBy: { date: 'asc' } });
  const shoot = shoots.find((s) => s.id === q.shoot) ?? shoots[0];
  if (!shoot) return (<><Head title="Capture" sub="Record poses against the class roster during a shoot." /><Insight>No shoots this week. Capture opens when a shoot is on the schedule.</Insight></>);
  const [students, poses] = await Promise.all([
    db.student.findMany({ where: { tenantId, schoolId: shoot.schoolId }, orderBy: [{ homeroom: 'asc' }, { name: 'asc' }] }),
    db.pose.findMany({ where: { tenantId, shootId: shoot.id }, orderBy: { number: 'asc' } }),
  ]);
  const of = (id: string) => poses.filter((p) => p.studentId === id);
  const done = (id: string) => of(id).some((p) => p.accepted);
  const cur = students.find((s) => s.id === q.student) ?? students.find((s) => !done(s.id)) ?? students[0];
  const mine = cur ? of(cur.id) : [];
  const best = mine.find((p) => !p.flag)?.number ?? null;
  const last = mine[mine.length - 1];
  return (
    <>
      <Head title="Capture" sub="Record up to three poses per student against the roster. Flag a bad frame and the best good one is offered for acceptance.">
        <Pill tone="ok">{shoot.school.name} · {shoot.type} · {dayLabel(shoot.date)}</Pill>
      </Head>
      {shoots.length > 1 && <div className="row">{shoots.map((s) => <Link key={s.id} className="btn sm" style={s.id === shoot.id ? { borderColor: 'var(--accent)' } : undefined} href={`/capture?shoot=${s.id}`}>{s.school.name} · {dayLabel(s.date)}</Link>)}</div>}
      {!students.length ? <Insight>{shoot.school.name} has no roster yet. Import it from the Schools screen, then come back.</Insight>
        : <Insight>{last?.flag ? <><b>{last.flag}</b> on pose {last.number}. Take another.</> : mine.length && best ? `Pose ${best} is the first clean frame for ${cur!.name}.` : `Ready for ${cur!.name}.`} Camera tethering is not part of this build; frames are recorded by hand here.</Insight>}
      {cur && (
        <div className="grid2">
          <div className="stack">
            <div className="finder" role="img" aria-label="Framing guide for a seated portrait"><div className="body-s" /><div className="head-s" /><div className={`face ${last?.flag ? 'flag' : ''}`} /><span className="cnr a" /><span className="cnr b" /><span className="cnr c" /><span className="cnr d" /><span className="tag">{cur.name} · pose {Math.min(mine.length + 1, 3)}/3</span><div className="hud"><span>{cur.homeroom}</span><span>{students.filter((s) => done(s.id)).length}/{students.length} done</span></div></div>
            <div className="poses">{[1, 2, 3].map((n) => { const p = mine.find((x) => x.number === n); return <div key={n} className={`pose ${p ? (p.flag ? 'flag' : p.accepted ? 'best' : '') : ''}`}><b>Pose {n}</b><br />{p ? (p.flag || (p.accepted ? 'Accepted' : 'Good')) : 'Not taken'}</div>; })}</div>
            <CaptureControls shootId={shoot.id} studentId={cur.id} taken={mine.length} best={best} />
          </div>
          <div className="card flush roster">
            <div className="item"><div className="body"><h3>Roster</h3><small>{students.filter((s) => done(s.id)).length} of {students.length} photographed</small></div></div>
            <div style={{ maxHeight: 520, overflowY: 'auto' }}>
              {students.map((s) => { const acc = of(s.id).find((p) => p.accepted); return <Link key={s.id} href={`/capture?shoot=${shoot.id}&student=${s.id}`} className="item" style={{ color: 'inherit', textDecoration: 'none', padding: '7px 16px', background: s.id === cur.id ? 'var(--accent-soft)' : undefined }}><div className="body">{s.name} <span className="faint">{s.homeroom}</span></div>{acc ? <Pill tone="ok">Pose {acc.number}</Pill> : s.id === cur.id ? <Pill tone="ai">Up now</Pill> : null}</Link>; })}
            </div>
          </div>
        </div>
      )}
      {!cur && students.length > 0 && <Empty>Everyone is photographed.</Empty>}
    </>
  );
}

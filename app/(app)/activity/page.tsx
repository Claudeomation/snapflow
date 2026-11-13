import { Empty, Head, Pill } from '@/components/bits';
import { db } from '@/lib/db';
import { page } from '@/lib/guard';

export default async function Activity() {
  const c = await page('/activity');
  const logs = await db.auditLog.findMany({ where: { tenantId: c.tenantId }, orderBy: { createdAt: 'desc' }, take: 100 });
  return (
    <>
      <Head title="Activity" sub="Every change made through SnapFlow, newest first. Undo a run from the operator panel right after it happens." />
      <div className="card flush">
        {logs.map((l) => <div className="item" key={l.id}><div className="body"><b style={l.undone ? { textDecoration: 'line-through' } : undefined}>{l.label}</b><small>{l.note}</small></div><div className="acts">{l.undone && <Pill>Undone</Pill>}<span className="faint num">{l.actor} · {l.createdAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div></div>)}
        {!logs.length && <Empty>Nothing yet.</Empty>}
      </div>
    </>
  );
}

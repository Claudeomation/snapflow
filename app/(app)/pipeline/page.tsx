import { Head, Insight, Pill } from '@/components/bits';
import { NewRecord, OpButton } from '@/components/ui';
import { db } from '@/lib/db';
import { page } from '@/lib/guard';
import { STAGES } from '@/lib/ops';
import { daysBetween, money } from '@/lib/format';

// A transparent score: how far along the deal is, minus points for going quiet.
const score = (d: { stage: string; lastTouch: Date }) => Math.max(5, Math.min(99, 30 + STAGES.indexOf(d.stage) * 17 - Math.max(0, daysBetween(d.lastTouch, new Date()) - 3) * 3));

export default async function Pipeline() {
  const c = await page('/pipeline');
  const deals = await db.deal.findMany({ where: { tenantId: c.tenantId }, orderBy: { valueCents: 'desc' } });
  const open = deals.filter((d) => d.stage !== 'Won');
  const top = [...open].sort((a, b) => score(b) * b.valueCents - score(a) * a.valueCents)[0];
  return (
    <>
      <Head title="Pipeline" sub="Every prospect, scored by how far along it is and how long since you last spoke.">
        <span className="pill num">{money(open.reduce((s, d) => s + d.valueCents, 0))} open</span>
        <NewRecord kind="deal" title="New deal" fields={[{ name: 'name', label: 'School or district', required: true }, { name: 'detail', label: 'What they want' }, { name: 'value', label: 'Annual value ($)', type: 'number', required: true }, { name: 'contactEmail', label: 'Contact email', type: 'email' }, { name: 'nextStep', label: 'Next step' }]} />
      </Head>
      {top && <Insight action={<OpButton actions={[{ op: 'send_followup', id: top.id }]} title={`Follow up with ${top.name}`} className="btn sm primary">Send follow-up</OpButton>}><b>{top.name}</b> is the deal to work today: {money(top.valueCents)}, last touched {daysBetween(top.lastTouch, new Date())} days ago. {top.nextStep}</Insight>}
      {!deals.length && <Insight>No deals yet. Add your first prospect to start the pipeline.</Insight>}
      <div className="kan">
        {STAGES.map((st) => {
          const ds = deals.filter((d) => d.stage === st);
          return (
            <div className="col" key={st}>
              <div><span>{st}</span><span className="num">{ds.length}</span></div>
              {ds.map((d) => (
                <div className="deal" key={d.id}>
                  <div className="row" style={{ justifyContent: 'space-between' }}><b>{d.name}</b>{st !== 'Won' && <Pill tone={score(d) >= 70 ? 'ok' : score(d) >= 45 ? 'warn' : ''}>{score(d)}</Pill>}</div>
                  <span className="muted">{d.detail}{d.rep && ` · ${d.rep}`}</span>
                  <b className="num">{money(d.valueCents)}</b>
                  <span className="muted" style={{ fontSize: 12.5 }}>{d.nextStep}</span>
                  {st !== 'Won' && <div className="row"><OpButton actions={[{ op: 'send_followup', id: d.id }]} title={`Follow up with ${d.name}`}>Follow up</OpButton><OpButton actions={[{ op: 'advance_deal', id: d.id }]} title={`Advance ${d.name}`} className="btn sm ghost">Advance</OpButton></div>}
                </div>
              ))}
              {!ds.length && <span className="faint">Empty</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}

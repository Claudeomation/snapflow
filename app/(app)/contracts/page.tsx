import { Empty, Head, Insight, Pill, Section } from '@/components/bits';
import { NewRecord, OpButton } from '@/components/ui';
import { db } from '@/lib/db';
import { page } from '@/lib/guard';
import { DEPTS } from '@/lib/ops';
import { dayLabel, money } from '@/lib/format';

const STEPS = ['draft', 'sent', 'viewed', 'signed'];
const NAMES: Record<string, string> = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', signed: 'Signed' };

export default async function Contracts() {
  const c = await page('/contracts');
  const tenantId = c.tenantId;
  const [contracts, schools, tasks] = await Promise.all([
    db.contract.findMany({ where: { tenantId }, include: { school: true }, orderBy: [{ signedAt: { sort: 'desc', nulls: 'first' } }] }),
    db.school.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    db.task.findMany({ where: { tenantId, done: false }, include: { contract: { include: { school: true } } }, orderBy: { createdAt: 'desc' } }),
  ]);
  const waiting = contracts.find((k) => k.status === 'viewed') ?? contracts.find((k) => k.status === 'sent');
  return (
    <>
      <Head title="Contracts" sub="Scope, price and e-signature. A signature gives every department its task at once.">
        {schools.length > 0 && <NewRecord kind="contract" title="New contract" fields={[{ name: 'schoolId', label: 'School', type: 'select', options: schools.map((s) => [s.id, s.name]), required: true }, { name: 'title', label: 'Title', required: true }, { name: 'scope', label: 'Scope and deliverables', type: 'textarea' }, { name: 'value', label: 'Value ($)', type: 'number', required: true }, { name: 'termEnds', label: 'Term ends', type: 'date' }]} />}
      </Head>
      {waiting ? <Insight>{waiting.school.name} {waiting.status === 'viewed' ? 'opened their agreement' : 'has been sent their agreement'} and has not signed yet. When they sign from the link, these departments get a task automatically: {DEPTS.map((d) => d[0]).join(', ')}.</Insight>
        : <Insight>{contracts.length ? 'No contracts are out for signature.' : 'No contracts yet. Add a school, then create its first contract.'}</Insight>}
      <Section title="Contracts">
        {contracts.map((k) => (
          <div className="item" key={k.id}>
            <div className="body">
              <b>{k.title}</b>
              <small>{money(k.valueCents)}{k.signedAt ? ` · signed ${dayLabel(k.signedAt)}${k.signedBy ? ` by ${k.signedBy}` : ''}` : k.sentAt ? ` · sent ${dayLabel(k.sentAt)}` : ''}{k.termEnds ? ` · term ends ${dayLabel(k.termEnds)}` : ''}</small>
              <div className="steps" style={{ marginTop: 8, maxWidth: 260 }}>{STEPS.map((s, i) => <i key={s} className={i <= STEPS.indexOf(k.status) ? 'on' : ''} />)}</div>
            </div>
            <div className="acts">
              <Pill tone={k.status === 'signed' ? 'ok' : ''}>{NAMES[k.status]}</Pill>
              {k.status !== 'signed' && <OpButton actions={[{ op: 'send_contract', id: k.id }]} title={`Send ${k.title}`} className={k.status === 'draft' ? 'btn sm primary' : 'btn sm'}>{k.status === 'draft' ? 'Send for signature' : 'Resend'}</OpButton>}
              {k.status !== 'signed' && <OpButton actions={[{ op: 'mark_signed', id: k.id }]} title={`Record signature: ${k.title}`}>Record signature</OpButton>}
            </div>
          </div>
        ))}
        {!contracts.length && <Empty>Nothing here yet.</Empty>}
      </Section>
      <Section title="Open department tasks" sub="Created when a contract is signed.">
        {tasks.map((k) => (
          <div className="item" key={k.id}><div className="body"><Pill>{k.dept}</Pill> <b>{k.label}</b><small>{k.contract?.school.name}</small></div><div className="acts"><OpButton actions={[{ op: 'complete_task', id: k.id }]} title={`Complete: ${k.label}`}>Mark done</OpButton></div></div>
        ))}
        {!tasks.length && <Empty>No open tasks.</Empty>}
      </Section>
    </>
  );
}

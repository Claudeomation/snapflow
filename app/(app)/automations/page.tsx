import { Head, Section } from '@/components/bits';
import { Segmented, Toggle } from '@/components/ui';
import { page } from '@/lib/guard';
import { RULES } from '@/lib/ops';
import { AREAS, canAct, LEVELS } from '@/lib/roles';

const WHAT = { suggest: 'The operator shows a plan and waits, even for internal changes. Queue items wait for approval.', ask: 'The operator handles internal work and asks before anything goes to a school or parent. Queue items wait for approval.', auto: 'The operator acts without asking, and the scheduled job runs queue items for this area on its own. Everything is logged.' };

export default async function Automations() {
  const c = await page('/automations');
  const edit = canAct(c.role, 'Settings');
  return (
    <>
      <Head title="Automations" sub="What SnapFlow proposes or does without being asked, and how much say you keep in each part of the business." />
      <div className="card">
        <div className="sechead"><h2>How much SnapFlow does on its own</h2></div>
        <div className="stack">{AREAS.map((a) => { const lvl = (c.tenant.autonomy[a] ?? 'ask') as keyof typeof LEVELS; return (
          <div className="row" key={a} style={{ justifyContent: 'space-between' }}><div style={{ maxWidth: '60ch' }}><b>{a}</b><div className="muted" style={{ fontSize: 12.5 }}>{WHAT[lvl]}</div></div>{edit ? <Segmented area={a} value={lvl} options={Object.entries(LEVELS)} /> : <span className="pill">{LEVELS[lvl]}</span>}</div>
        ); })}</div>
      </div>
      <Section title="Rules" sub="Each rule watches your data and either acts or puts a proposal in the approval queue.">
        {Object.entries(RULES).map(([key, r]) => { const on = !c.tenant.rulesOff.includes(key); return (
          <div className="item" key={key}><div className="body"><b>{r.name}</b><small>When: {r.when}</small></div>{edit ? <Toggle on={on} label={r.name} title={`Turn ${on ? 'off' : 'on'}: ${r.name}`} action={{ op: 'toggle_rule', id: key, value: on ? 'off' : 'on' }} /> : <span className="pill">{on ? 'On' : 'Off'}</span>}</div>
        ); })}
      </Section>
    </>
  );
}

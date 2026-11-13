import Link from 'next/link';
import { Empty, Head, Insight, Pill } from '@/components/bits';
import { AskButton, DraftEditor, NewRecord, OpButton } from '@/components/ui';
import { db } from '@/lib/db';
import { page } from '@/lib/guard';

export default async function Support({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const c = await page('/support');
  const { id } = await searchParams;
  const tenantId = c.tenantId;
  const [tickets, schools] = await Promise.all([
    db.ticket.findMany({ where: { tenantId }, include: { school: true }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }], take: 100 }),
    db.school.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
  ]);
  const open = tickets.filter((k) => k.status === 'open');
  const hrs = (k: { dueAt: Date }) => Math.round((k.dueAt.getTime() - Date.now()) / 3600000);
  const sel = tickets.find((k) => k.id === id) ?? open[0] ?? tickets[0];
  const drafted = open.filter((k) => k.draft.trim() && k.priority !== 'High');
  return (
    <>
      <Head title="Support" sub="Tickets from staff and from the parent portal. Replies are drafted for you to review, edit and send.">
        {drafted.length > 0 && <AskButton q="Send all drafted replies except the high priority ones">Send {drafted.length} drafted</AskButton>}
        <NewRecord kind="ticket" title="New ticket" fields={[{ name: 'schoolId', label: 'School', type: 'select', options: [['', 'No school'], ...schools.map((s) => [s.id, s.name] as [string, string])] }, { name: 'subject', label: 'Subject', required: true }, { name: 'fromName', label: 'From' }, { name: 'fromEmail', label: 'Their email', type: 'email' }, { name: 'priority', label: 'Priority', type: 'select', options: [['Normal', 'Normal'], ['High', 'High'], ['Low', 'Low']] }, { name: 'body', label: 'Message', type: 'textarea', required: true }]} />
      </Head>
      <Insight>{open.length ? `${open.length} open. ${open.filter((k) => hrs(k) <= 2).length} due within 2 hours. ${open.filter((k) => k.draft.trim()).length} have a draft.` : 'No open tickets.'}</Insight>
      <div className="grid2 even">
        <div className="card flush">
          {tickets.map((k) => (
            <Link key={k.id} href={`/support?id=${k.id}`} className="item" style={{ color: 'inherit', textDecoration: 'none', background: k.id === sel?.id ? 'var(--accent-soft)' : undefined }}>
              <div className="body"><b>{k.subject}</b><small>{[k.fromName, k.school?.name].filter(Boolean).join(' · ')}</small></div>
              {k.status === 'open' ? <Pill tone={hrs(k) <= 2 ? 'bad' : hrs(k) <= 6 ? 'warn' : ''}>{hrs(k) < 0 ? `${-hrs(k)}h overdue` : `${hrs(k)}h left`}</Pill> : <Pill tone="ok">Resolved</Pill>}
            </Link>
          ))}
          {!tickets.length && <Empty>No tickets yet.</Empty>}
        </div>
        {sel && (
          <div className="card stack">
            <div className="sechead" style={{ margin: 0 }}><h2>{sel.subject}</h2><Pill tone={sel.priority === 'High' ? 'bad' : ''}>{sel.priority} priority</Pill></div>
            <p className="muted">{[sel.fromName, sel.fromEmail, sel.school?.name].filter(Boolean).join(' · ')}</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{sel.body}</p>
            <span className="label">Reply</span>
            <DraftEditor ticketId={sel.id} draft={sel.draft} disabled={sel.status !== 'open'} />
            {sel.status === 'open' ? (
              <div className="row">
                {sel.draft.trim() && <OpButton actions={[{ op: 'reply_ticket', id: sel.id }]} title={`Send reply: ${sel.subject}`} className="btn primary">Send reply and resolve</OpButton>}
                <OpButton actions={[{ op: 'draft_reply', id: sel.id }]} title={`Draft reply: ${sel.subject}`} className="btn">{sel.draft.trim() ? 'Redraft' : 'Draft a reply'}</OpButton>
              </div>
            ) : <Pill tone="ok">Resolved</Pill>}
          </div>
        )}
      </div>
    </>
  );
}

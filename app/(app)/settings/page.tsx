import { Empty, Head, Pill, Section } from '@/components/bits';
import { MemberForm, RemoveMember, StudioForm } from '@/components/ui';
import { clerkEnabled } from '@/lib/auth';
import { db } from '@/lib/db';
import { page } from '@/lib/guard';
import { aiConnected } from '@/lib/operator';
import { emailConnected } from '@/lib/outbox';
import { ROLES } from '@/lib/roles';

const OUT: Record<string, [string, '' | 'ok' | 'warn' | 'bad']> = { sent: ['Sent', 'ok'], not_connected: ['Not sent · email not connected', 'warn'], no_address: ['Not sent · no address', 'warn'], failed: ['Failed', 'bad'] };

export default async function Settings() {
  const c = await page('/settings');
  const [team, outbox] = await Promise.all([
    db.user.findMany({ where: { tenantId: c.tenantId }, orderBy: { createdAt: 'asc' } }),
    db.outbox.findMany({ where: { tenantId: c.tenantId }, orderBy: { createdAt: 'desc' }, take: 15 }),
  ]);
  const owner = c.role === 'Owner';
  const links: [string, boolean | null, string][] = [
    ['Sign-in (Clerk)', clerkEnabled, clerkEnabled ? 'People sign in with their own account.' : 'Not configured. The app is running in demo mode.'],
    ['Claude', aiConnected(), aiConnected() ? 'The operator understands free-form requests and drafts ticket replies.' : 'No API key. The operator understands a fixed set of requests.'],
    ['Email (Resend)', emailConnected(), emailConnected() ? 'Outgoing messages are delivered.' : 'Not configured. Outgoing messages are saved below and not delivered.'],
    ['Text messages', null, 'Not built yet.'],
    ['QuickBooks', null, 'Not built yet.'],
    ['Storefront sync (gotPhoto, Candid Color)', null, 'Not built yet. Galleries and order status are kept in SnapFlow.'],
    ['Student information systems', null, 'Not built yet. Rosters are imported as CSV.'],
  ];
  return (
    <>
      <Head title="Settings" sub="Your studio, your team and what SnapFlow is connected to." />
      <div className="grid2 even">
        <div className="card"><span className="label">Studio</span><StudioForm name={c.tenant.name} brandHue={c.tenant.brandHue} canEdit /><p className="faint" style={{ marginTop: 10 }}>Parent portal address: /portal/{c.tenant.slug}</p></div>
        <div className="card stack">
          <span className="label">Team</span>
          {team.map((u) => <div className="row" key={u.id} style={{ justifyContent: 'space-between' }}><div><b>{u.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{u.email}{clerkEnabled && !u.clerkId ? ' · has not signed in yet' : ''}</div></div><div className="row"><Pill>{u.role}</Pill>{owner && u.id !== c.user.id && <RemoveMember id={u.id} />}</div></div>)}
          {owner && <><span className="label" style={{ marginTop: 8 }}>Add someone</span><MemberForm roles={[...ROLES]} /><p className="faint">They join this studio the first time they sign in with that email.</p></>}
        </div>
      </div>
      <Section title="Connections">
        {links.map(([name, on, note]) => <div className="item" key={name}><div className="body"><b>{name}</b><small>{note}</small></div>{on === null ? <Pill>Not available</Pill> : <Pill tone={on ? 'ok' : 'warn'}>{on ? 'Connected' : 'Not connected'}</Pill>}</div>)}
      </Section>
      <Section title="Outbox" sub="The last 15 outgoing messages.">
        {outbox.map((m) => <div className="item" key={m.id}><div className="body"><b>{m.subject}</b><small>To {m.toAddress || 'no address'} · {m.createdAt.toLocaleString('en-US')}{m.detail && ` · ${m.detail}`}</small></div><Pill tone={OUT[m.status]?.[1] ?? ''}>{OUT[m.status]?.[0] ?? m.status}</Pill></div>)}
        {!outbox.length && <Empty>Nothing has been sent yet.</Empty>}
      </Section>
    </>
  );
}

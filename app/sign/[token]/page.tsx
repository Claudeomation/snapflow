import { notFound } from 'next/navigation';
import { signFromLink } from '@/app/public-actions';
import { db } from '@/lib/db';
import { dayLabel, money } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Sign({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const k = await db.contract.findUnique({ where: { signToken: token }, include: { school: true } });
  if (!k) notFound();
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: k.tenantId } });
  if (k.status === 'sent') await db.contract.update({ where: { id: k.id }, data: { status: 'viewed', viewedAt: new Date() } });
  return (
    <div className="plain" style={{ ['--hue' as string]: tenant.brandHue }}>
      <div className="portal">
        <div className="bar2">{tenant.name}</div>
        <div className="in">
          <div><h1>{k.title}</h1><p className="muted">{k.school.name} · {money(k.valueCents)}{k.termEnds && ` · term through ${dayLabel(k.termEnds)}`}</p></div>
          <div><span className="label">Scope and deliverables</span><p style={{ whiteSpace: 'pre-wrap' }}>{k.scope || 'No scope text was added to this agreement.'}</p></div>
          {k.status === 'signed' ? <div className="card"><b>Signed</b><p className="muted">Signed by {k.signedBy} on {k.signedAt ? dayLabel(k.signedAt) : ''}. Thank you.</p></div> : (
            <form className="form" action={signFromLink.bind(null, token)}>
              {error && <p className="err">Type your full name and tick the box to sign.</p>}
              <label>Your full name<input name="name" required minLength={2} maxLength={120} autoComplete="name" /></label>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" name="agree" required /> I am authorized to sign for {k.school.name} and I agree to this agreement.</label>
              <div><button className="btn primary">Sign agreement</button></div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

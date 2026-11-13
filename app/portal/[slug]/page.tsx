import { notFound } from 'next/navigation';
import { submitTicket } from '@/app/public-actions';
import { db } from '@/lib/db';
import { dayLabel, today } from '@/lib/format';

export const dynamic = 'force-dynamic';
const STATUS: Record<string, string> = { none: 'No order placed yet', ordered: 'Order received', lab: 'At the lab', shipped: 'Shipped' };

export default async function Portal({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ code?: string; sent?: string }> }) {
  const { slug } = await params;
  const { code, sent } = await searchParams;
  const tenant = await db.tenant.findUnique({ where: { slug } });
  if (!tenant) notFound();
  const clean = (code ?? '').trim().toUpperCase().slice(0, 20);
  const entry = clean ? await db.galleryEntry.findUnique({ where: { tenantId_accessCode: { tenantId: tenant.id, accessCode: clean } }, include: { student: true, gallery: { include: { school: true } } } }) : null;
  if (entry && !entry.viewedAt) await db.galleryEntry.update({ where: { id: entry.id }, data: { viewedAt: new Date() } });
  const retakes = await db.shoot.findMany({ where: { tenantId: tenant.id, date: { gte: today() }, type: { contains: 'retake', mode: 'insensitive' } }, include: { school: true }, orderBy: { date: 'asc' }, take: 20 });
  return (
    <div className="plain" style={{ ['--hue' as string]: tenant.brandHue }}>
      <div className="portal">
        <div className="bar2">{tenant.name}</div>
        <div className="in">
          <div><h3>Find your order</h3><p className="muted">Enter the access code from your picture day flyer.</p></div>
          <form className="field" method="get"><input name="code" defaultValue={clean} placeholder="Access code" aria-label="Access code" required /><button className="btn primary">Look up</button></form>
          {clean && (entry
            ? <div className="card"><b>{entry.student.name.split(' ')[0]} · {entry.gallery.school.name}</b><p>{entry.gallery.name}: {STATUS[entry.status] ?? entry.status}{entry.package && ` · ${entry.package}`}</p><p className="muted">Ordering closes {dayLabel(entry.gallery.closesOn)}.</p></div>
            : <p className="err">No order found for that code. Check the flyer, or send us a message below.</p>)}
          <div>
            <h3>Retake days</h3>
            {retakes.length ? retakes.map((s) => <p key={s.id} className="muted">{s.school.name}: {dayLabel(s.date)}</p>) : <p className="muted">No retake days are scheduled right now.</p>}
          </div>
          <div>
            <h3>Ask us a question</h3>
            {sent === 'yes' ? <p className="muted">Thanks. Your message is with our team and we will reply by email.</p> : (
              <form className="form" action={submitTicket.bind(null, slug)}>
                {sent === 'invalid' && <p className="err">Please fill in every field with a valid email.</p>}
                {sent === 'busy' && <p className="err">We are receiving a lot of messages. Please try again in an hour.</p>}
                <label>Your name<input name="name" required maxLength={120} /></label>
                <label>Email<input name="email" type="email" required maxLength={200} /></label>
                <label>Subject<input name="subject" required maxLength={200} /></label>
                <label>Message<textarea name="body" rows={4} required maxLength={4000} /></label>
                <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999 }} />
                <div><button className="btn primary">Send</button></div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

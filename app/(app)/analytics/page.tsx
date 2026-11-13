import { Empty, Head, Insight, Pill } from '@/components/bits';
import { AskButton } from '@/components/ui';
import { db } from '@/lib/db';
import { page } from '@/lib/guard';
import { money, pct, today } from '@/lib/format';

export default async function Analytics() {
  const c = await page('/analytics');
  const t = today();
  const tenantId = c.tenantId;
  const months = [3, 2, 1, 0].map((back) => new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - back, 1)));
  const [paid, galleries] = await Promise.all([
    db.invoice.findMany({ where: { tenantId, status: 'paid', paidOn: { gte: new Date(Date.UTC(months[0].getUTCFullYear() - 1, months[0].getUTCMonth(), 1)) } }, select: { amountCents: true, paidOn: true } }),
    db.gallery.findMany({ where: { tenantId }, include: { school: true, entries: { select: { status: true } } } }),
  ]);
  const sum = (y: number, m: number) => paid.filter((i) => i.paidOn!.getUTCFullYear() === y && i.paidOn!.getUTCMonth() === m).reduce((s, i) => s + i.amountCents, 0) / 100;
  const now = months.map((m) => sum(m.getUTCFullYear(), m.getUTCMonth()));
  const last = months.map((m) => sum(m.getUTCFullYear() - 1, m.getUTCMonth()));
  const top = Math.max(...now, ...last);
  const step = top <= 0 ? 1 : Math.pow(10, Math.floor(Math.log10(top))) * (top / Math.pow(10, Math.floor(Math.log10(top))) > 5 ? 2.5 : top / Math.pow(10, Math.floor(Math.log10(top))) > 2 ? 1 : 0.5);
  const mx = Math.max(step, Math.ceil(top / step) * step);
  const ticks = Array.from({ length: Math.round(mx / step) + 1 }, (_, i) => i * step);
  const W = 560, H = 220, L = 52, B = 28, T = 16, gw = (W - L) / 4, bw = 34;
  const y = (v: number) => T + (H - T - B) * (1 - v / mx);
  const k = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)));
  const totalNow = now.reduce((a, b) => a + b, 0), totalLast = last.reduce((a, b) => a + b, 0);
  const rows = galleries.map((g) => ({ g, part: pct(g.entries.filter((e) => e.status !== 'none').length, g.entries.length) }));
  return (
    <>
      <Head title="Analytics" sub="This season against last, from your own invoices and galleries." />
      <Insight action={<AskButton q="Which schools are behind last year on participation?">Which schools are behind?</AskButton>}>{totalLast ? `Collected ${money(totalNow * 100)} over the last four months, ${totalNow >= totalLast ? 'up' : 'down'} ${Math.abs(Math.round((totalNow / totalLast - 1) * 100))}% on the same months last year.` : `Collected ${money(totalNow * 100)} over the last four months. There is no data for the same months last year to compare against.`}</Insight>
      <div className="card">
        <div className="sechead"><h2>Payments received by month</h2><div className="row"><span className="pill"><span className="dot" style={{ background: 'var(--faint)' }} />Last year</span><span className="pill"><span className="dot" />This year</span></div></div>
        <div className="tablebox"><svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 420, display: 'block' }} role="img" aria-label="Payments received by month, this year and last year">
          {ticks.map((v) => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" /><text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--faint)">${k(v)}</text></g>)}
          {months.map((m, i) => { const cx = L + gw * i + gw / 2; return (
            <g key={i}>
              <rect x={cx - bw - 2} y={y(last[i])} width={bw} height={y(0) - y(last[i])} rx="3" fill="var(--faint)" opacity=".45" />
              <rect x={cx + 2} y={y(now[i])} width={bw} height={y(0) - y(now[i])} rx="3" fill="var(--accent)" />
              {now[i] > 0 && <text x={cx + 2 + bw / 2} y={y(now[i]) - 5} textAnchor="middle" fontSize="11" fill="var(--fg)">${k(now[i])}</text>}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--muted)">{m.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}{i === 3 ? ' (to date)' : ''}</text>
            </g>
          ); })}
        </svg></div>
      </div>
      <div className="card flush"><div className="tablebox"><table>
        <thead><tr><th>Gallery</th><th>This year</th><th>Last year</th><th>Change</th></tr></thead>
        <tbody>{rows.map(({ g, part }) => { const d = g.lastYearPart == null ? null : part - g.lastYearPart; return <tr key={g.id}><td><b>{g.school.name}</b> <span className="muted">{g.name}</span></td><td className="num">{part}%</td><td className="num muted">{g.lastYearPart == null ? 'n/a' : `${g.lastYearPart}%`}</td><td>{d == null ? '' : <Pill tone={d >= 0 ? 'ok' : d < -5 ? 'bad' : 'warn'}>{d > 0 ? '+' : ''}{d} pts</Pill>}</td></tr>; })}</tbody>
      </table></div>{!rows.length && <Empty>No galleries yet.</Empty>}</div>
    </>
  );
}

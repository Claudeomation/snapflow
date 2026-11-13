import { db } from './db';

export const emailConnected = () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;

/** Sends an email through Resend when it is configured. Every attempt is recorded, sent or not. */
export async function deliver(tenantId: string, runId: string, to: string, subject: string, body: string): Promise<'sent' | 'not_connected' | 'no_address' | 'failed'> {
  let status: 'sent' | 'not_connected' | 'no_address' | 'failed' = 'not_connected';
  let detail = '';
  if (!to) status = 'no_address';
  else if (emailConnected()) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, text: body }),
      });
      status = res.ok ? 'sent' : 'failed';
      if (!res.ok) detail = `Resend returned ${res.status}`;
    } catch (e) {
      status = 'failed';
      detail = e instanceof Error ? e.message : 'network error';
    }
  }
  await db.outbox.create({ data: { tenantId, runId, toAddress: to, subject, body, status, detail } });
  return status;
}

export function deliveryNote(results: string[]): string {
  const n = (s: string) => results.filter((r) => r === s).length;
  const parts: string[] = [];
  if (n('sent')) parts.push(`${n('sent')} sent`);
  if (n('not_connected')) parts.push(`${n('not_connected')} saved to the outbox (email is not connected)`);
  if (n('no_address')) parts.push(`${n('no_address')} skipped, no email address on file`);
  if (n('failed')) parts.push(`${n('failed')} failed`);
  return parts.join(', ') || 'Nothing to send';
}

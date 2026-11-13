import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import { db } from './db';

/**
 * Storefront sync. Order data arrives as an export file from the storefront (GotPhoto, Candid
 * Color's CORE, or anything that produces a CSV) or as JSON through /api/ingest/orders.
 * Both paths normalize rows and call applyOrders().
 */
export const FIELDS = {
  accessCode: 'Access code',
  studentName: 'Student name',
  firstName: 'First name',
  lastName: 'Last name',
  orderRef: 'Order number',
  status: 'Order status',
  package: 'Product or package',
  amount: 'Amount',
  parentEmail: 'Parent email',
} as const;
export type FieldKey = keyof typeof FIELDS;
export type Mapping = Partial<Record<FieldKey, string>>;
export type OrderRow = { accessCode?: string; studentName?: string; orderRef?: string; status?: string; package?: string; amountCents?: number; parentEmail?: string };

/** Parses delimited text. Detects comma, semicolon or tab, and handles quoted fields. */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^﻿/, '');
  const first = src.slice(0, src.search(/\r?\n/) === -1 ? src.length : src.search(/\r?\n/));
  const count = (ch: string) => first.split(ch).length - 1;
  const delim = count('\t') > count(',') && count('\t') > count(';') ? '\t' : count(';') > count(',') ? ';' : ',';
  const out: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) out.push(row);
  const headers = (out.shift() ?? []).map((h) => h.trim());
  return { headers, rows: out.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

// Words that suggest what a column holds. These are guesses to pre-fill the mapping; the person confirms it.
const HINTS: [FieldKey, RegExp][] = [
  ['accessCode', /access.?code|login.?code|gallery.?code|^code$|password|zugangscode|qr/i],
  ['firstName', /first.?name|given.?name|vorname/i],
  ['lastName', /last.?name|surname|family.?name|nachname/i],
  ['studentName', /student|child|subject|participant|^name$|full.?name|kind/i],
  ['orderRef', /order.?(no|num|number|id|#)|invoice.?(no|num|number)|^order$|bestellnummer/i],
  ['status', /status|state|fulfil+ment/i],
  ['package', /package|product|item|article|artikel|paket/i],
  ['amount', /total|amount|gross|revenue|price|sum|betrag|gesamt/i],
  ['parentEmail', /e-?mail/i],
];

export function detectMapping(headers: string[]): Mapping {
  const m: Mapping = {};
  for (const [field, re] of HINTS) {
    const hit = headers.find((h) => re.test(h) && !Object.values(m).includes(h));
    if (hit) m[field] = hit;
  }
  return m;
}

/** "1.234,56", "1,234.56", "$48.00" and "48" all become cents. */
export function toCents(raw: string): number {
  let s = raw.replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
  if (comma > dot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const RANK = { none: 0, ordered: 1, lab: 2, shipped: 3 } as const;
export type Status = keyof typeof RANK;

/** Maps a storefront's status wording onto SnapFlow's four states. Unknown wording counts as ordered. */
export function toStatus(raw: string | undefined): Status {
  const s = (raw ?? '').toLowerCase();
  if (/cancel|refund|void|storn/.test(s)) return 'none';
  if (/ship|deliver|dispatch|sent|complete|fulfilled|versand|versendet/.test(s)) return 'shipped';
  if (/lab|produc|print|process|transmit|in progress/.test(s)) return 'lab';
  return 'ordered';
}

export function mapRows(rows: Record<string, string>[], m: Mapping): OrderRow[] {
  const get = (r: Record<string, string>, f: FieldKey) => (m[f] ? (r[m[f]!] ?? '').trim() : '');
  return rows.map((r) => ({
    accessCode: get(r, 'accessCode'),
    studentName: get(r, 'studentName') || [get(r, 'firstName'), get(r, 'lastName')].filter(Boolean).join(' '),
    orderRef: get(r, 'orderRef'),
    status: m.status ? get(r, 'status') : undefined,
    package: get(r, 'package'),
    amountCents: m.amount ? toCents(get(r, 'amount')) : 0,
    parentEmail: get(r, 'parentEmail'),
  }));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const flip = (s: string) => { const p = s.split(',').map((x) => x.trim()); return p.length === 2 ? `${p[1]} ${p[0]}` : s; };

export type ImportOptions = { amountIs: 'order' | 'line'; addMissing: boolean; source: 'file' | 'api'; fileName?: string; actor: string; dryRun?: boolean };
export type ImportResult = { rows: number; matched: number; students: number; added: number; unmatched: number; unmatchedSample: string[]; runId?: string };

/**
 * Applies order rows to one gallery. Rows are matched to a student by access code first, then by
 * name when exactly one student has that name. A file may hold several rows per order (line items)
 * and several orders per student. Students missing from the file are left as they are, so a partial
 * or date-ranged export is safe to import. Importing the same file twice gives the same result.
 */
export async function applyOrders(tenantId: string, galleryId: string, rows: OrderRow[], o: ImportOptions): Promise<ImportResult> {
  const gallery = await db.gallery.findFirst({ where: { id: galleryId, tenantId }, include: { school: true, entries: { include: { student: true } } } });
  if (!gallery) throw new Error('Gallery not found');
  const byCode = new Map(gallery.entries.map((e) => [e.accessCode.toUpperCase(), e]));
  const byName = new Map<string, typeof gallery.entries>();
  for (const e of gallery.entries) { const k = norm(e.student.name); byName.set(k, [...(byName.get(k) ?? []), e]); }

  type Agg = { orders: Map<string, { cents: number; status: Status }>; packages: Set<string>; email: string };
  const hits = new Map<string, Agg>();
  const missing = new Map<string, { name: string; row: OrderRow; agg: Agg }>();
  const unmatched: string[] = [];
  let matched = 0;

  const add = (agg: Agg, r: OrderRow, n: number) => {
    const ref = r.orderRef || `row-${n}`;
    const cur = agg.orders.get(ref);
    const status = toStatus(r.status);
    const cents = r.amountCents ?? 0;
    agg.orders.set(ref, cur ? { cents: o.amountIs === 'order' ? Math.max(cur.cents, cents) : cur.cents + cents, status: RANK[status] < RANK[cur.status] ? status : cur.status } : { cents, status });
    if (r.package) agg.packages.add(r.package);
    if (r.parentEmail) agg.email = r.parentEmail;
  };
  const fresh = (): Agg => ({ orders: new Map(), packages: new Set(), email: '' });

  rows.forEach((r, n) => {
    const name = flip(r.studentName ?? '');
    let entry = r.accessCode ? byCode.get(r.accessCode.toUpperCase()) : undefined;
    if (!entry && name) { const c = byName.get(norm(name)); if (c?.length === 1) entry = c[0]; }
    if (entry) { matched++; const agg = hits.get(entry.id) ?? fresh(); add(agg, r, n); hits.set(entry.id, agg); return; }
    if (o.addMissing && name && !byName.has(norm(name))) { const k = norm(name); const m = missing.get(k) ?? { name, row: r, agg: fresh() }; add(m.agg, r, n); missing.set(k, m); matched++; return; }
    unmatched.push([r.orderRef && `Order ${r.orderRef}`, name, r.accessCode && `code ${r.accessCode}`].filter(Boolean).join(' · ') || `Row ${n + 2}`);
  });

  const settle = (agg: Agg) => {
    const live = [...agg.orders.values()].filter((x) => x.status !== 'none');
    const status: Status = live.length ? live.reduce((a, b) => (RANK[b.status] < RANK[a.status] ? b : a)).status : 'none';
    return { status, amountCents: live.reduce((s, x) => s + x.cents, 0), package: live.length ? [...agg.packages].join(', ').slice(0, 190) : '', orderRef: [...agg.orders.keys()].filter((k) => !k.startsWith('row-')).join(', ').slice(0, 190) };
  };
  const result: ImportResult = { rows: rows.length, matched, students: hits.size + missing.size, added: missing.size, unmatched: unmatched.length, unmatchedSample: unmatched.slice(0, 8) };
  if (o.dryRun) return result;

  const runId = randomUUID();
  const undoUpdates: object[] = [];
  const entries = new Map(gallery.entries.map((e) => [e.id, e]));
  for (const [id, agg] of hits) {
    const e = entries.get(id)!;
    const next = settle(agg);
    undoUpdates.push({ kind: 'update', model: 'galleryEntry', id, data: { status: e.status, amountCents: e.amountCents, package: e.package, orderRef: e.orderRef } });
    await db.galleryEntry.update({ where: { id }, data: next });
    if (agg.email && !e.student.parentEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(agg.email)) await db.student.update({ where: { id: e.studentId }, data: { parentEmail: agg.email } });
  }
  const newStudents: string[] = [];
  const code = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const c = Array.from({ length: 8 }, () => a[randomInt(32)]).join(''); return `${c.slice(0, 4)}-${c.slice(4)}`; };
  for (const m of missing.values()) {
    const s = await db.student.create({ data: { tenantId, schoolId: gallery.schoolId, name: m.name.slice(0, 120), parentEmail: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.agg.email) ? m.agg.email : '' } });
    newStudents.push(s.id);
    const given = m.row.accessCode?.toUpperCase();
    await db.galleryEntry.create({ data: { tenantId, galleryId, studentId: s.id, accessCode: given && !byCode.has(given) ? given : code(), ...settle(m.agg) } });
  }
  const excIds: string[] = [];
  const open = new Set((await db.orderException.findMany({ where: { tenantId, galleryId, resolvedAt: null }, select: { subject: true } })).map((x) => x.subject));
  for (const u of unmatched.slice(0, 50)) {
    if (open.has(u)) continue;
    open.add(u);
    excIds.push((await db.orderException.create({ data: { tenantId, galleryId, kind: 'Unmatched order', subject: u, fix: 'No student on the roster matches this order. Check the name or access code, add the student, then import again.' } })).id);
  }
  await db.gallery.update({ where: { id: galleryId }, data: { lastSyncAt: new Date() } });
  const run = await db.importRun.create({ data: { tenantId, galleryId, source: o.source, fileName: o.fileName ?? '', actor: o.actor, rows: rows.length, matched, added: missing.size, unmatched: unmatched.length } });
  const undo = [{ kind: 'update', model: 'gallery', id: galleryId, data: { lastSyncAt: gallery.lastSyncAt } }, { kind: 'delete', model: 'importRun', ids: [run.id] }, { kind: 'delete', model: 'orderException', ids: excIds }, { kind: 'delete', model: 'student', ids: newStudents }, ...undoUpdates];
  await db.auditLog.create({ data: { tenantId, runId, actor: o.actor, op: 'import_orders', label: `Import orders into ${gallery.school.name} ${gallery.name}`, note: summary(result), undo } });
  return { ...result, runId };
}

export const summary = (r: ImportResult) => `${r.rows} ${r.rows === 1 ? 'row' : 'rows'}: ${r.students} ${r.students === 1 ? 'student' : 'students'} updated${r.added ? `, ${r.added} added to the roster` : ''}${r.unmatched ? `, ${r.unmatched} could not be matched and were logged as exceptions` : ''}`;

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
/** Creates a new ingest key for a studio. Only the hash is stored; the key is shown once. */
export async function rotateIngestToken(tenantId: string): Promise<string> {
  const token = `sf_${randomBytes(24).toString('base64url')}`;
  await db.tenant.update({ where: { id: tenantId }, data: { ingestTokenHash: hashToken(token) } });
  return token;
}

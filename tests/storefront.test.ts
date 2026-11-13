import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { undoRun } from '@/lib/ops';
import { applyOrders, detectMapping, mapRows, parseCsv, toCents, toStatus } from '@/lib/storefront';
import { addDays, today } from '@/lib/format';

// The export below is synthetic. It is not a copy of any storefront's real file layout.
const FILE = `Order No;Access Code;First Name;Last Name;Product;Total;Status;Email
1001;AAAA-1111;Ava;Bennett;"Package B; with frame";48,00;Shipped;ava.parent@example.com
1001;AAAA-1111;Ava;Bennett;Digital add-on;48,00;Shipped;ava.parent@example.com
1002;;Noah;Castillo;Package A;32,00;In production;
1003;ZZZZ-0000;Ghost;Student;Package A;32,00;Paid;
1004;CCCC-3333;Mia;Dawson;Package A;32,00;Cancelled;
`;
const opts = { amountIs: 'order' as const, addMissing: false, source: 'file' as const, actor: 'Test' };
let T = '', G = '', other = '';

beforeAll(async () => {
  const t = await db.tenant.create({ data: { name: 'sync', slug: `sync-${Date.now()}` } });
  T = t.id;
  const school = await db.school.create({ data: { tenantId: T, name: 'North Elementary' } });
  const g = await db.gallery.create({ data: { tenantId: T, schoolId: school.id, name: 'Fall portraits', closesOn: addDays(today(), 5) } });
  G = g.id;
  for (const [name, code, status] of [['Ava Bennett', 'AAAA-1111', 'none'], ['Noah Castillo', 'BBBB-2222', 'none'], ['Mia Dawson', 'CCCC-3333', 'ordered'], ['Leo Ferreira', 'DDDD-4444', 'shipped']]) {
    const s = await db.student.create({ data: { tenantId: T, schoolId: school.id, name } });
    await db.galleryEntry.create({ data: { tenantId: T, galleryId: G, studentId: s.id, accessCode: code, status } });
  }
  other = (await db.tenant.create({ data: { name: 'other', slug: `sync-other-${Date.now()}` } })).id;
});

afterAll(async () => {
  for (const tenantId of [T, other]) {
    for (const m of ['auditLog', 'importRun', 'orderException', 'galleryEntry', 'gallery', 'student', 'school'] as const)
      await (db[m] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { tenantId } });
    await db.tenant.delete({ where: { id: tenantId } });
  }
  await db.$disconnect();
});

const state = async () => Object.fromEntries((await db.galleryEntry.findMany({ where: { galleryId: G }, include: { student: true } })).map((e) => [e.student.name, [e.status, e.amountCents, e.package, e.orderRef]]));

describe('reading an export file', () => {
  it('detects the delimiter, keeps quoted delimiters, and guesses the columns', () => {
    const { headers, rows } = parseCsv(FILE);
    expect(headers).toHaveLength(8);
    expect(rows).toHaveLength(5);
    expect(rows[0].Product).toBe('Package B; with frame');
    expect(detectMapping(headers)).toEqual({ accessCode: 'Access Code', firstName: 'First Name', lastName: 'Last Name', orderRef: 'Order No', status: 'Status', package: 'Product', amount: 'Total', parentEmail: 'Email' });
  });
  it('reads money and status wording', () => {
    expect([toCents('48,00'), toCents('$1,234.50'), toCents('1.234,50 €'), toCents('')]).toEqual([4800, 123450, 123450, 0]);
    expect([toStatus('Shipped'), toStatus('In production'), toStatus('Paid'), toStatus('Cancelled'), toStatus(undefined)]).toEqual(['shipped', 'lab', 'ordered', 'none', 'ordered']);
  });
});

describe('applying orders to a gallery', () => {
  const rows = () => { const { headers, rows } = parseCsv(FILE); return mapRows(rows, detectMapping(headers)); };

  it('a dry run reports the outcome and changes nothing', async () => {
    const before = await state();
    const r = await applyOrders(T, G, rows(), { ...opts, dryRun: true });
    expect([r.rows, r.students, r.unmatched]).toEqual([5, 3, 1]);
    expect(await state()).toEqual(before);
  });
  it('matches by code, then by name; counts an order total once; cancels; leaves absent students alone', async () => {
    const r = await applyOrders(T, G, rows(), opts);
    expect(await state()).toEqual({
      'Ava Bennett': ['shipped', 4800, 'Package B; with frame, Digital add-on', '1001'],
      'Noah Castillo': ['lab', 3200, 'Package A', '1002'],
      'Mia Dawson': ['none', 0, '', '1004'],
      'Leo Ferreira': ['shipped', 0, '', ''],
    });
    expect((await db.student.findFirstOrThrow({ where: { tenantId: T, name: 'Ava Bennett' } })).parentEmail).toBe('ava.parent@example.com');
    expect(await db.orderException.count({ where: { tenantId: T, galleryId: G, kind: 'Unmatched order' } })).toBe(1);
    expect(r.runId).toBeTruthy();
  });
  it('importing the same file again changes nothing and logs no duplicate exception', async () => {
    const before = await state();
    await applyOrders(T, G, rows(), opts);
    expect(await state()).toEqual(before);
    expect(await db.orderException.count({ where: { tenantId: T, galleryId: G } })).toBe(1);
  });
  it('adds line amounts when the file is one row per item', async () => {
    await applyOrders(T, G, rows(), { ...opts, amountIs: 'line' });
    expect((await state())['Ava Bennett'][1]).toBe(9600);
  });
  it('can add students who are missing from the roster, and undo removes them', async () => {
    const r = await applyOrders(T, G, rows(), { ...opts, addMissing: true });
    expect(r.added).toBe(1);
    expect((await state())['Ghost Student']).toEqual(['ordered', 3200, 'Package A', '1003']);
    await undoRun(T, r.runId!);
    expect((await state())['Ghost Student']).toBeUndefined();
    expect((await state())['Ava Bennett'][1]).toBe(9600);
  });
  it("refuses a gallery that belongs to another studio", async () => {
    await expect(applyOrders(other, G, rows(), opts)).rejects.toThrow('Gallery not found');
  });
});

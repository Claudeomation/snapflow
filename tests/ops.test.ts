import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { describe as describeSteps, execute, undoRun } from '@/lib/ops';
import { proposals } from '@/lib/proposals';
import { addDays, today } from '@/lib/format';

// Runs against a real Postgres. Each run creates two throwaway studios and removes them afterwards.
const tag = `test-${Date.now()}`;
let A = '', B = '';
const ids: Record<string, string> = {};
const owner = (tenantId: string) => ({ tenantId, role: 'Owner' as const, actor: 'Test', rulesOff: [] as string[] });

async function studio(slug: string) {
  const t = await db.tenant.create({ data: { name: slug, slug } });
  const school = await db.school.create({ data: { tenantId: t.id, name: 'North Elementary', zone: 'North', contactEmail: 'office@example.com' } });
  const near = await db.photographer.create({ data: { tenantId: t.id, name: 'Near', zone: 'North', email: 'near@example.com' } });
  await db.photographer.create({ data: { tenantId: t.id, name: 'Far', zone: 'South' } });
  const shoot = await db.shoot.create({ data: { tenantId: t.id, schoolId: school.id, type: 'Retakes', date: addDays(today(), 2), students: 50 } });
  const contract = await db.contract.create({ data: { tenantId: t.id, schoolId: school.id, title: 'Agreement', valueCents: 100000 } });
  const invoice = await db.invoice.create({ data: { tenantId: t.id, schoolId: school.id, description: 'ID cards', amountCents: 50000, status: 'sent', dueOn: addDays(today(), -10) } });
  return { t: t.id, school: school.id, near: near.id, shoot: shoot.id, contract: contract.id, invoice: invoice.id };
}

beforeAll(async () => {
  const a = await studio(`${tag}-a`), b = await studio(`${tag}-b`);
  A = a.t; B = b.t;
  Object.assign(ids, a, { otherShoot: b.shoot, otherContract: b.contract });
});

afterAll(async () => {
  for (const tenantId of [A, B]) {
    for (const m of ['auditLog', 'outbox', 'dismissal', 'task', 'contract', 'invoice', 'shoot', 'photographer', 'school'] as const)
      await (db[m] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { tenantId } });
    await db.tenant.delete({ where: { id: tenantId } });
  }
  await db.$disconnect();
});

describe('approval queue', () => {
  it('proposes the same-zone photographer for an open shoot and chases the overdue invoice', async () => {
    const q = await proposals(A, []);
    const staff = q.find((p) => p.rule === 'staffing');
    expect(staff?.actions).toEqual([{ op: 'assign', id: ids.shoot, id2: ids.near }]);
    expect(q.find((p) => p.rule === 'invoice_chase')?.actions).toEqual([{ op: 'chase_invoice', id: ids.invoice }]);
  });
  it('produces nothing for a rule that is switched off, or a dismissed proposal', async () => {
    expect((await proposals(A, ['staffing'])).some((p) => p.rule === 'staffing')).toBe(false);
    const key = (await proposals(A, [])).find((p) => p.rule === 'staffing')!.key;
    await db.dismissal.create({ data: { tenantId: A, key } });
    expect((await proposals(A, [])).some((p) => p.key === key)).toBe(false);
    await db.dismissal.deleteMany({ where: { tenantId: A } });
  });
});

describe('operations', () => {
  it('assigns, logs, records the briefing in the outbox, and undoes cleanly', async () => {
    const run = await execute(owner(A), [{ op: 'assign', id: ids.shoot, id2: ids.near }]);
    expect(run.steps[0].ok).toBe(true);
    expect((await db.shoot.findUniqueOrThrow({ where: { id: ids.shoot } })).photographerId).toBe(ids.near);
    expect(await db.outbox.count({ where: { tenantId: A, runId: run.runId, status: 'not_connected' } })).toBe(1);
    expect(await db.auditLog.count({ where: { tenantId: A, runId: run.runId } })).toBe(1);
    await undoRun(A, run.runId);
    const s = await db.shoot.findUniqueOrThrow({ where: { id: ids.shoot } });
    expect([s.photographerId, s.status]).toEqual([null, 'scheduled']);
    expect(await db.outbox.count({ where: { tenantId: A, runId: run.runId } })).toBe(0);
  });
  it('signing creates one task per department and undo removes them', async () => {
    const run = await execute(owner(A), [{ op: 'mark_signed', id: ids.contract }]);
    expect(await db.task.count({ where: { tenantId: A, contractId: ids.contract } })).toBe(6);
    await undoRun(A, run.runId);
    expect(await db.task.count({ where: { tenantId: A } })).toBe(0);
    expect((await db.contract.findUniqueOrThrow({ where: { id: ids.contract } })).status).toBe('draft');
  });
  it("cannot touch another studio's records", async () => {
    const run = await execute(owner(A), [{ op: 'assign', id: ids.otherShoot, id2: ids.near }, { op: 'mark_signed', id: ids.otherContract }]);
    expect(run.steps.map((s) => s.ok)).toEqual([false, false]);
    expect((await db.shoot.findUniqueOrThrow({ where: { id: ids.otherShoot } })).photographerId).toBeNull();
    expect((await db.contract.findUniqueOrThrow({ where: { id: ids.otherContract } })).status).toBe('draft');
  });
  it('refuses operations outside the role', async () => {
    const run = await execute({ ...owner(A), role: 'Photographer' }, [{ op: 'chase_invoice', id: ids.invoice }, { op: 'set_autonomy', id: 'Support', value: 'auto' }]);
    expect(run.steps.every((s) => s.ok === false)).toBe(true);
    expect(await db.outbox.count({ where: { tenantId: A, runId: run.runId } })).toBe(0);
  });
  it('drops unknown operations and asks before outbound sends unless the area runs on its own', async () => {
    const acts = [{ op: 'drop_database' }, { op: 'chase_invoice', id: ids.invoice }, { op: 'assign', id: ids.shoot, id2: ids.near }];
    expect((await describeSteps(A, {}, acts)).map((s) => [s.action.op, s.needsOK])).toEqual([['chase_invoice', true], ['assign', false]]);
    expect((await describeSteps(A, { Accounting: 'auto', Scheduling: 'suggest' }, acts)).map((s) => s.needsOK)).toEqual([false, true]);
  });
});

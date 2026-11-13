// Sample data for local development and demos. Run with `npm run db:seed`.
// It replaces the "brightline" studio only; other studios are left alone.
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const now = new Date();
const base = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
const day = (n: number) => new Date(base.getTime() + n * 86400000);
const FIRST = ['Ava', 'Noah', 'Mia', 'Leo', 'Zoe', 'Eli', 'Ruby', 'Theo', 'Ivy', 'Owen', 'Nora', 'Max', 'Lena', 'Sam', 'Cora', 'Jude', 'Elsa', 'Finn', 'Maya', 'Cole'];
const LAST = ['Bennett', 'Castillo', 'Dawson', 'Ferreira', 'Hartman', 'Nakamura', 'Okafor', 'Pham', 'Quinn', 'Reyes'];

async function main() {
  const old = await db.tenant.findUnique({ where: { slug: 'brightline' } });
  if (old) {
    const where = { tenantId: old.id };
    for (const m of ['auditLog', 'outbox', 'dismissal', 'pose', 'galleryEntry', 'orderException', 'gallery', 'task', 'contract', 'ticket', 'invoice', 'shoot', 'student', 'photographer', 'deal', 'school', 'user'] as const)
      await (db[m] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where });
    await db.tenant.delete({ where: { id: old.id } });
  }
  const t = await db.tenant.create({ data: { name: 'Brightline Portraits', slug: 'brightline', autonomy: { Scheduling: 'ask', Sales: 'ask', Contracts: 'ask', Orders: 'ask', Support: 'ask', Accounting: 'ask' } } });
  const tenantId = t.id;
  await db.user.create({ data: { tenantId, email: 'owner@example.com', name: 'Sample Owner', role: 'Owner' } });

  const S: Record<string, string> = {};
  const schools: [string, string, string, string, number, string][] = [
    ['maple', 'Maple Grove Elementary', 'Riverbend USD', 'North', 412, '2 backdrops, 1 strobe kit'],
    ['riverbend', 'Riverbend Middle', 'Riverbend USD', 'West', 688, '3 backdrops, 2 strobe kits, risers'],
    ['cedar', 'Cedar Ridge High', 'Cedar Ridge ISD', 'South', 1340, '4 backdrops, 3 strobe kits, risers'],
    ['oakmont', 'Oakmont Elementary', 'Cedar Ridge ISD', 'North', 356, '2 backdrops, 1 strobe kit'],
    ['lakeview', 'Lakeview K-8', 'Lakeview Schools', 'East', 540, '2 backdrops, 2 strobe kits'],
    ['pioneer', 'Pioneer High', 'Lakeview Schools', 'North', 1120, '4 backdrops, 3 strobe kits'],
    ['sunnyside', 'Sunnyside Elementary', 'Sunnyside Charter', 'East', 298, ''],
    ['westfield', 'Westfield Middle', 'Riverbend USD', 'West', 610, '3 backdrops, 2 strobe kits'],
  ];
  for (const [k, name, district, zone, enrollment, gear] of schools)
    S[k] = (await db.school.create({ data: { tenantId, name, district, zone, enrollment, gear, contactName: 'Front office', contactEmail: `office@${k}.example.com` } })).id;

  const students: Record<string, string[]> = {};
  for (const k of Object.keys(S)) {
    students[k] = [];
    for (let i = 0; i < 40; i++) {
      const name = `${FIRST[(i * 7 + k.length) % FIRST.length]} ${LAST[(i * 3 + k.length) % LAST.length]}`;
      students[k].push((await db.student.create({ data: { tenantId, schoolId: S[k], name, homeroom: `Rm ${10 + (i % 4)}`, parentEmail: `parent${i}@${k}.example.com` } })).id);
    }
  }

  const P: Record<string, string> = {};
  const crew: [string, string, string, string, number[]][] = [['dana', 'Dana R.', 'North', 'Hourly', []], ['marcus', 'Marcus T.', 'East', 'Day rate', []], ['priya', 'Priya S.', 'South', 'Salary', []], ['jordan', 'Jordan K.', 'North', 'Day rate', []], ['elena', 'Elena V.', 'West', 'Hourly', []], ['sam', 'Sam O.', 'East', 'Hourly', [3]]];
  for (const [k, name, zone, payType, off] of crew) P[k] = (await db.photographer.create({ data: { tenantId, name, zone, payType, email: `${k}@brightline.example.com`, daysOff: off.map(day) } })).id;

  const shoots: [string, string, number, number, string | null, string][] = [
    ['maple', 'Fall portrait retakes', 0, 86, 'dana', 'onsite'], ['cedar', 'Winter sports', 0, 140, 'priya', 'briefed'], ['lakeview', 'Yearbook candids', 0, 60, 'marcus', 'complete'],
    ['oakmont', 'Fall portrait retakes', 3, 74, null, 'scheduled'], ['pioneer', 'Senior portrait makeups', 3, 38, 'jordan', 'briefed'], ['westfield', 'Winter sports', 4, 110, null, 'scheduled'],
    ['sunnyside', 'Fall portrait retakes', 5, 52, null, 'scheduled'], ['riverbend', 'Band and choir groups', 5, 180, 'elena', 'briefed'], ['cedar', 'Club photos', 6, 95, 'priya', 'scheduled'],
  ];
  for (const [s, type, d, n, p, status] of shoots) await db.shoot.create({ data: { tenantId, schoolId: S[s], type, date: day(d), students: n, photographerId: p ? P[p] : null, status } });

  const deals: [string, string, string, number, string, string, number][] = [
    ['Northgate ISD', '6 schools · fall and spring', 'Proposal', 84000, 'You', 'Follow up on the proposal', 6], ['St. Brendan Academy', 'K-8 · portraits and yearbook', 'Negotiation', 19500, 'You', 'Answer the commission question', 2],
    ['Harbor Point Charter', '2 campuses', 'Contacted', 27000, 'Alex M.', 'Book a discovery call', 9], ['Elm Street Preschool', 'Spring portraits', 'Lead', 4200, 'Alex M.', 'Qualify enrollment size', 14],
    ['Cedar Ridge ISD middle schools', '3 schools · expansion', 'Proposal', 46000, 'You', 'Send references', 4], ['Sunnyside Charter', 'New school · 3-year term', 'Won', 22400, 'You', 'Contract out for signature', 1],
  ];
  for (const [name, detail, stage, v, rep, nextStep, ago] of deals) await db.deal.create({ data: { tenantId, name, detail, stage, valueCents: v * 100, rep, nextStep, lastTouch: day(-ago), contactEmail: `contact@${name.toLowerCase().replace(/[^a-z]+/g, '')}.example.com` } });

  const scope = 'Fall and spring portraits, retakes, staff composite, yearbook images.';
  await db.contract.create({ data: { tenantId, schoolId: S.sunnyside, title: 'Sunnyside Elementary · 3-year service agreement', scope, valueCents: 2240000, status: 'viewed', sentAt: day(-3), viewedAt: day(-1), termEnds: day(1095) } });
  await db.contract.create({ data: { tenantId, schoolId: S.pioneer, title: 'Pioneer High · service agreement', scope, valueCents: 6100000, status: 'signed', signedAt: day(-327), signedBy: 'Principal', termEnds: day(38) } });
  await db.contract.create({ data: { tenantId, schoolId: S.riverbend, title: 'Riverbend Middle · sports addendum', scope: 'Fall, winter and spring team and individual photos.', valueCents: 860000, status: 'sent', sentAt: day(-3) } });
  await db.contract.create({ data: { tenantId, schoolId: S.maple, title: 'Maple Grove Elementary · service agreement', scope, valueCents: 1890000, status: 'signed', signedAt: day(-100), signedBy: 'Principal', termEnds: day(620) } });
  await db.contract.create({ data: { tenantId, schoolId: S.cedar, title: 'Cedar Ridge High · service agreement', scope, valueCents: 7450000, status: 'signed', signedAt: day(-117), signedBy: 'Principal', termEnds: day(250) } });

  const galleries: [string, string, number, number, number][] = [['riverbend', 'Fall portraits', 5, 58, 41], ['cedar', 'Fall portraits', 9, 47, 50], ['maple', 'Fall portraits', 2, 60, 63], ['pioneer', 'Senior portraits', 14, 55, 52]];
  for (const [s, name, closes, last, part] of galleries) {
    const g = await db.gallery.create({ data: { tenantId, schoolId: S[s], name, closesOn: day(closes), lastYearPart: last } });
    const ordered = Math.round((part / 100) * students[s].length);
    await db.galleryEntry.createMany({ data: students[s].map((studentId, i) => ({ tenantId, galleryId: g.id, studentId, accessCode: `${s.slice(0, 2).toUpperCase()}-${1000 + i * 37 + closes}`, status: i < ordered ? (i % 3 === 0 ? 'lab' : 'shipped') : 'none', package: i < ordered ? ['Package A', 'Package B', 'Digital only'][i % 3] : '', amountCents: i < ordered ? [3200, 4800, 2500][i % 3] : 0, viewedAt: i < ordered + 6 ? day(-4) : null })) });
    if (s === 'riverbend') await db.orderException.create({ data: { tenantId, galleryId: g.id, kind: 'Missing image', subject: 'Order RI-1037 · pose 2 not matched to the student', fix: 'Re-link the pose by student ID in capture, then release the order to the lab.' } });
    if (s === 'cedar') await db.orderException.create({ data: { tenantId, galleryId: g.id, kind: 'Lab delay', subject: 'Batch 0917 · 14 orders running 3 days late', fix: 'Tell the families the new delivery date and credit shipping.' } });
  }

  const hours = (h: number) => new Date(Date.now() + h * 3600000);
  const tickets: [string, string, string, string, number, string, string][] = [
    ['oakmont', 'When is retake day?', 'Jamie Lin', 'Normal', 5, 'My daughter was absent on picture day. When are retakes and do I need to sign up?', 'Hi Jamie,\n\nRetakes at Oakmont Elementary are coming up next week. No sign-up is needed; her teacher will send her down with the class. New proofs appear in your gallery within 5 days.\n'],
    ['riverbend', 'Wrong child in gallery', 'Chris Ortiz', 'High', 1, "The access code on our flyer opens another student's photos.", ''],
    ['lakeview', 'Staff composite by Dec 1?', 'Office manager', 'Normal', 9, 'Our board meets Dec 3 and we would love to have the composite on display.', 'Hello,\n\nThe staff composite is in layout now. We will confirm the ship date by tomorrow and send tracking as soon as it leaves the lab.\n'],
    ['pioneer', 'Yearbook deadline question', 'Yearbook advisor', 'Low', 22, 'What is the last day to submit senior makeup portraits for the book?', ''],
  ];
  for (const [s, subject, fromName, priority, h, body, draft] of tickets) await db.ticket.create({ data: { tenantId, schoolId: S[s], subject, fromName, fromEmail: `${fromName.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, priority, dueAt: hours(h), body, draft } });

  const inv: [string, string, number, string, number, number | null][] = [
    ['cedar', 'Fall yearbook services', 12400, 'paid', -60, -40], ['pioneer', 'Senior banner package', 2980, 'sent', -64, null], ['riverbend', 'ID cards', 1200, 'sent', -49, null],
    ['lakeview', 'Staff composite', 640, 'sent', -6, null], ['westfield', 'Sports team photos', 3150, 'draft', 0, null],
    ['maple', 'Fall portraits commission', 9800, 'paid', -75, -50], ['riverbend', 'Fall portraits commission', 15200, 'paid', -45, -20], ['cedar', 'Fall portraits commission', 21400, 'paid', -30, -12],
    ['cedar', 'Fall yearbook services', 11800, 'paid', -425, -400], ['maple', 'Fall portraits commission', 9100, 'paid', -440, -410], ['riverbend', 'Fall portraits commission', 16900, 'paid', -410, -390], ['cedar', 'Fall portraits commission', 18700, 'paid', -395, -375],
  ];
  for (const [s, description, amt, status, issued, paid] of inv) await db.invoice.create({ data: { tenantId, schoolId: S[s], description, amountCents: amt * 100, status, issuedOn: day(issued), dueOn: status === 'draft' ? null : day(issued + 30), paidOn: paid == null ? null : day(paid) } });

  console.log('Seeded Brightline Portraits');
}

main().finally(() => db.$disconnect());

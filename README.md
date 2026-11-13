# SnapFlow

The operating system for school photography companies, built around an AI operator.

Staff open a briefing instead of a dashboard: what needs approval, what is at risk, today's shoots. An operator panel takes plain-language requests, shows a plan, runs it, and logs every step with undo. Anything that reaches a school or parent waits for approval unless that department is set to run on its own.

## Run it locally

You need Node 22 and a Postgres database.

```bash
cp .env.example .env
```

```bash
npm install
```

```bash
npm run db:push
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Open http://localhost:3000. With `DEMO_MODE=1` and no Clerk keys you are signed in as the Owner of the sample studio, and a banner says so.

## Go live

1. **Database.** Create a Neon project and set `DATABASE_URL`. Run `npm run db:push` against it once.
2. **Sign-in.** Create a Clerk application and set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Remove `DEMO_MODE`. The first person to sign in becomes the Owner of a new studio. People the Owner adds under Settings join that studio the first time they sign in with that email.
3. **Claude.** Set `ANTHROPIC_API_KEY`. The operator then understands free-form requests and drafts ticket replies. Without it, the operator understands a fixed set of requests.
4. **Email.** Set `RESEND_API_KEY` and `EMAIL_FROM` (a sender on a domain verified in Resend). Without them, every outgoing message is saved to the outbox under Settings and nothing is delivered.
5. **Address.** Set `APP_URL` to the public address so signing links point to the right place.
6. **Scheduled job.** Set `CRON_SECRET`. `vercel.json` calls `/api/cron` hourly; it runs approval-queue items for departments set to "Run on its own". Vercel sends the secret as a bearer token automatically.
7. Deploy to Vercel. The build command is `npm run build`.

Do not run the seed against a live database unless you want the sample studio in it.

## What works

| Area | What it does |
|---|---|
| Briefing | Approval queue derived from live data, at-risk list, today's shoots, last 24 hours of activity |
| Operator | Plain-language requests through Claude, plans with approval, audit log, undo |
| Pipeline | Deals by stage, a transparent score, follow-up emails, stage changes |
| Contracts | Create, email a signing link, public e-signature page, six department tasks on signature, renewals |
| Schools | School records, CSV roster import |
| Schedule | Shoots, photographers, zone and availability matching, briefing emails, check-in and completion |
| Capture | Up to three poses per student against the roster, flags, accept the best |
| Orders | Galleries with a per-student access code, order import from a storefront export file, participation against last year, reminders, exceptions |
| Support | Tickets from staff and the parent portal, drafted replies, send and resolve |
| Parent portal | Public page per studio: order lookup by access code, retake days, ask a question |
| Accounting | Invoices, sending, reminders, payments, billed by school |
| Analytics | Payments by month against last year, participation by gallery |
| Automations | Per-department autonomy, rules on and off |
| Settings | Studio name and brand color, team and roles, connection status, outbox |

Six roles (Owner, Admin, Sales rep, Photographer, Support, Accounting) limit which screens open and which operations run. The server enforces both.

## What is not built

- QuickBooks sync, in either direction
- A direct, automatic connection to GotPhoto or Candid Color (see Storefront sync below)
- Student information system sync; rosters are CSV
- Text messages
- Camera tethering and image storage; Capture records poses by hand and stores no photos
- Online payment for parents or for invoices
- Payroll, commission tracking, cash flow forecast, 1099 preparation
- Custom report builder and scheduled PDF reports
- Subscription billing, a cross-studio admin panel, custom domains
- A photographer mobile app with GPS check-in; check-in is a button on the Schedule screen
- Rate limiting on the operator and on signed-in actions. The public question form is capped at 60 per studio per hour.

## Storefront sync

Order status reaches SnapFlow in two ways.

**Import a file.** On the Orders screen, choose Import orders on a gallery and pick the order export from your storefront (CSV, semicolon or tab separated also work). SnapFlow guesses which column is which, you confirm, and it shows what will change before anything is saved. Rows are matched to students by access code first, then by name. Rows that match no one are logged as exceptions. Importing the same file twice is safe, and an import can be undone from the operator panel.

**Post to the ingest endpoint.** An Owner creates an ingest key under Settings. A connection or script then sends orders as JSON:

```bash
curl -X POST "$APP_URL/api/ingest/orders" \
  -H "Authorization: Bearer $INGEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{"galleryId":"<gallery id>","orders":[{"accessCode":"ABCD-1234","orderRef":"1001","status":"shipped","package":"Package B","amount":48}]}'
```

There is no direct GotPhoto or Candid Color connection. GotPhoto states that its API is open only to lab partners and enterprise customers, and no public API was found for Candid Color's CORE. If you get API access from either, the connection would be a small adapter that calls the ingest path above.

The column guessing was written without access to a real GotPhoto or CORE export, so check the mapping on your first import.

## How it is put together

- **Next.js App Router, React server components, Prisma, Postgres, Clerk, the Anthropic SDK.**
- `lib/ops.ts` is the one vocabulary of operations. Buttons, the approval queue, the scheduled job and the operator all call `execute()`, which checks the role, scopes every query to the studio, writes the audit log and records how to undo.
- `lib/proposals.ts` derives the approval queue from live data on every load, so it is never stale.
- `lib/operator.ts` sends Claude a snapshot of the studio and gets back a plan as structured output. Claude never writes to the database; it only chooses operations, which go through the same checks as a button click. Text typed by parents and schools is passed as data and the model is told not to treat it as instructions; outbound operations still need a person's approval unless that department is set to run on its own.
- Server actions replace the tRPC layer named in the original plan. With server components there is no separate API to keep in step.
- Every table carries `tenantId`. Isolation is enforced in application queries, not by Postgres row-level security.

## Checks

```bash
npm run typecheck
```

```bash
npm test
```

Tests run against a real Postgres and cover the approval rules, undo, role limits and that one studio cannot touch another's records.

`prototype/index.html` is the earlier single-file design prototype, kept for reference.

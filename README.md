# SnapFlow

The operating system for school photography companies, rebuilt around an AI operator.

This repository holds the AI-operated front end: a single-page prototype with sample data and no backend. Open `index.html` in a browser to run it.

## How it works

- **Briefing** replaces the dashboard. It opens on what needs approval, what is at risk, today's shoots and what was handled overnight.
- **Operator panel** takes plain-language requests, shows a step-by-step plan, runs it and logs every step with undo.
- **Approval rules** are set per department under Automations: suggest only, ask before sending, or run on its own. Anything that reaches a school or parent waits for approval unless that department is set to run on its own.
- **One vocabulary of operations** (`OPS` in `index.html`) is shared by the buttons, the operator and the model, so every action behaves the same however it is triggered.

## Screens

Briefing, Pipeline, Contracts (with the six-department scope-to-delivery cascade), Schools, Schedule, Capture (3-pose check), Orders, Support, Parent portal, Accounting, Analytics, Automations, Tenants, Activity. Six roles change what is visible: Owner, Admin, Sales rep, Photographer, Support, Accounting.

## What is simulated

All data is invented sample data for a made-up tenant. QuickBooks, gotPhoto, Candid Color, SIS syncs, email and SMS are simulated; nothing is sent anywhere.

The operator uses Claude when the page runs as a Claude artifact. Opened as a plain file, it falls back to a built-in set of commands.

## Next steps toward production

1. Port the shell and screens to Next.js with Clerk auth and role-based navigation.
2. Replace `seed()` with a Prisma schema and tRPC queries for each entity.
3. Move `OPS` to server-side mutations with an audit log, and call the model from the server.
4. Wire the real integrations one at a time, starting with scheduling and contracts.

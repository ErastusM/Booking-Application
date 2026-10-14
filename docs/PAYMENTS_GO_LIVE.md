# Online payments: going live

Online card payments for bookings are built and deployed, but **switched off**.
This is the list of everything that must be true before they are switched on,
and how to switch them on (and off again). It follows the owner's payment
specification (October 2026).

Nothing here is done by code alone: most items need the owner, PayGate or a
lawyer. Tick them off in the admin console as they are done: **Admin console →
Money → Settings → "Before payments go live"**. Each item there records who
confirmed it, when, and a note.

## 1. Launch gates (Money → Settings → "Before payments go live")

| Gate | Who | What "done" means |
|---|---|---|
| Card processing fee entered | Director | PayGate's actual Namibian fees (percentage and fixed) entered under Prices and fees. Checked automatically. |
| Chargeback fee entered | Director | PayGate's chargeback fee entered. Checked automatically. |
| No booking value loses money | Automatic | The simulator shows no negative Bookplus net at any booking value, for either plan. Fix with the minimum commission or the minimum online booking value. |
| PayGate approval | Owner | PayGate's **written** approval of the structure: Bookplus collects for businesses, deducts its commission, and pays businesses out in N$ to Namibian banks. For subscriptions later (Phase 5), recurring billing too. |
| Prices approved | Owner | The owner has approved the simulator results with the real fees. |
| Legal clearance | Owner | The legal position for Bookplus collecting and paying out is on record (the owner confirmed it is cleared). |
| Terms reviewed | Lawyer | The lawyer has reviewed the Terms and Privacy Policy (section 3). |
| Live test passed | Builder + owner | Section 5 done on the live account. |
| Payout schedule confirmed | Owner | Weekly on Friday (the specification) or every two weeks: set it under Prices and fees, then confirm here. |

## 2. PayGate

1. Merchant account in Bookplus's name, settling in **Namibian Dollars**.
2. The **terminals' details** (PGID and Encryption Key; section 4). Put them
   on the server. Never paste them into chat, a ticket or the repository.
3. PayGate checks the website before going live. With payments switched on,
   the site shows what it looks for:
   - **who collects and the currency**: Legal notice → "Online payments" (Bookplus
     collects for the business, in N$, based in Namibia);
   - **refund and cancellation policy**: Terms → "Refunds of online payments"
     (business terms: "Online payments through Bookplus"), linked from the pay
     step ("How paying online works · Refund rules");
   - **card security**: card details are entered only on PayGate's page (Terms,
     Privacy Policy, Legal notice);
   - **delivery**: the service is provided in person at the booked time (Legal notice);
   - **contact details**: Legal notice (email and both phone numbers).
4. **Card logos** on the pay step: ask PayGate which card brands Bookplus will
   accept and for the official logo files; they are not in the app yet.

## 3. Legal text (lawyer)

The payment clauses are in `packages/config/legal/`:

- `terms.mjs`: client terms "Paying online" and "Refunds of online payments";
  business terms "Online payments through Bookplus" and "Fees" (the plans).
- `privacy.mjs`: PayGate as a processor, the online payments application
  (ID number, documents, bank account), retention, security.
- `notice.mjs`: "Online payments".

They are written to match what the code does (each clause notes the code it
rests on). They appear only when payments are switched on; to read them
before that, run an app with `VITE_PAYMENTS_PREVIEW=true` (the e2e runs do).
For the lawyer to confirm or change:

- how long financial records are kept: the Privacy Policy says "for as long
  as the law requires" until a period is confirmed (the proposal is 5 years,
  `ACCOUNTING_RECORDS_YEARS` in `apps/api/src/constants/retention.js`);
- refunds for late cancellations and no-shows ("not refunded unless the
  business agrees") against consumer-protection law;
- recovering a lost chargeback, and a negative balance, from the business;
- VAT on Bookplus's fees (the VAT settings are under Prices and fees);
- the liability, indemnity and governing-law clauses were removed in
  September 2026 pending legal advice: the lawyer decides whether to add any.

After the review, update the "last updated" dates (`TERMS_LAST_UPDATED`,
`PRIVACY_LAST_UPDATED`, `NOTICE_LAST_UPDATED`).

## 4. Switching on

PayGate gives two terminals, each with a PGID, an Encryption Key and a login
for map.paygate.co.za:

- **"One time and tokenization"** (3D Secure): clients paying when they book.
  This is the one the server uses now.
- **"NON3DS"**: charging a saved card with no client present, for subscription
  renewals (Phase 5). Keep it safe; it is not used yet.

The map.paygate.co.za logins are for people (transactions, refunds, settlement
reports), never for the server.

On the server, in `/app/.env.production`:

```
PAYGATE_ID=
PAYGATE_PASSWORD=
PAYGATE_CALLBACK_BASE_URL=https://api.bookplus.pro
CUSTOMER_APP_URL=https://www.bookplus.pro
MFA_ENCRYPTION_KEY=
PAYMENTS_ENABLED=true
```

- `PAYGATE_ID`: the "One time and tokenization" terminal's PGID.
- `PAYGATE_PASSWORD`: the same terminal's Encryption Key.
- `CUSTOMER_APP_URL` is `www`, not `app.` (nginx redirects `app.` to `www`).
- `MFA_ENCRYPTION_KEY`: make it once with `openssl rand -hex 32`, before any
  admin turns on two-step sign-in, and never change it.
- `PAYMENTS_ENABLED=true` opens the payment routes; nothing is charged until
  Bookplus approves a business, and the screens stay hidden until the code
  switch below.

Optional: `PAYMENT_HOLD_MINUTES` (default 15), `MFA_SESSION_HOURS` (default 12),
and `PAYGATE_ENCRYPTION_KEY` (below).

Reload the API so it reads the file (`docker compose restart` does not):

```
cd /app
docker compose up -d --force-recreate server
```

Then **check the connection**: admin console → Money → Settings → "Check the
PayGate connection". It opens a N$5.00 test session at PayGate that nobody pays
and shows, check by check, whether PayGate accepts the ID and password, signs
with the key Bookplus checks, and can reach Bookplus. If it says PayGate signs
with a different key, add `PAYGATE_ENCRYPTION_KEY=<the terminal's Encryption
Key>`, reload the API and check again.

In the code: `packages/config/features.mjs` → `paymentsEnabled: true`, merged
through a pull request (merging to main deploys). Both are needed: the API flag
opens the payment routes, the code flag shows the screens and the payment
clauses in the legal pages.

## 5. Test run

1. **Staging with PayGate's test account** (the public PayHost test
   credentials from PayGate's documentation). One business applies, is
   approved, switches on a deposit. A client books and pays (approved card),
   then a declined card and "Try again". Cancel as the client in time (full
   refund), as the business (full refund). Owner refund within the balance,
   and one above it (Bookplus approves). Payout run: prepare, bank file, paid.
2. **Live, small**: one real booking of the minimum online value paid with a
   real card, refunded, and the refund seen on the card statement.
3. **One pilot business** (the specification's controlled pilot) before
   anyone else is approved.

## 6. Before launch: operations

- Off-site backups running (DigitalOcean Spaces, `ops/backup/README.md`).
- `ALERT_WEBHOOK_URL` set, so payment errors reach the team.
- The leaked secrets rotated.
- At least two admins with the money roles (a director cannot approve their
  own requests), each with two-step sign-in on.

## Switching off again

Set `PAYMENTS_ENABLED=false` (and `paymentsEnabled: false` if the screens should
go too). New bookings are then paid at the appointment.

**Payments in progress:** while the flag is off, PayGate's callbacks to Bookplus
are refused, so a client paying at that moment would not be confirmed. Switch
off when no payment is in progress. If one was, switch back on briefly, or use
**Money → Payments → Ask PayGate** on it once payments are on again: that asks
PayGate what happened and applies it. Money already collected stays on the
businesses' balances and is paid out as normal.

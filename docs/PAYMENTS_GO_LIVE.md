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

### Plan clauses (business owners paying for Bookplus)

Separate switch: `subscriptionBillingEnabled` in `packages/config/features.mjs`
(off). While off, the business terms keep only "we will tell you about any
fee before it applies". When on, they add:

- `terms.mjs`: business terms "Your Bookplus plan" (kept free, the trial,
  prices fixed at the trial, the first payment with 3D Secure, **the authority
  to charge the saved card every month until cancelled**, failed payments,
  14 days' notice of a price rise, cancelling, refunds of errors, deleting the
  saved card), and "Fees" pointing at it;
- `privacy.mjs` (business): the plan and the saved-card token, why, PayGate,
  how long;
- `notice.mjs` (business): "Paying for your Bookplus plan".

Decisions marked `DECISION` in `terms.mjs` and `privacy.mjs` are built as
written (subscriptions step 3): the 7-day retry window and pausing the listing
after it, cancelling at the end of the paid month with no part-month refunds,
and deleting the saved card at PayGate when the plan ends or the card is
replaced. They are still the owner's decisions to confirm. For the lawyer: the
recurring-charge authority, no part-month refunds, pausing for non-payment,
replacing a card by paying the next month, and VAT on the plan price. Switch
on together with the API's `SUBSCRIPTION_BILLING_ENABLED`.

After the review, update the "last updated" dates (`TERMS_LAST_UPDATED`,
`PRIVACY_LAST_UPDATED`, `NOTICE_LAST_UPDATED`).

## 4. Switching on

PayGate gives two terminals, each with a PGID, an Encryption Key and a login
for map.paygate.co.za:

- **"One time and tokenization"** (3D Secure): clients paying when they book.
  This is the one the server uses now.
- **"NON3DS"**: charging a business's saved card each month for its Bookplus
  plan, with nobody present (`PAYGATE_RECURRING_*`, see "Plans: monthly
  payments" below). Put it on the server only when switching plans on.

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

## Plans: paying by card (subscriptions, steps 2 and 3)

Separate from booking payments, and off until `SUBSCRIPTION_BILLING_ENABLED=true`.

**Starting the plan.** A business on its free trial (or whose trial has ended,
or whose plan ended) presses **Account → Your plan → Add card and start plan**:
it pays its first month on PayGate's page with terminal 1 ("One time and
tokenization", the `PAYGATE_*` settings above, 3D Secure), and PayGate saves
the card in its vault. Adding a card early never shortens the trial: the paid
month starts when it ends. Bookplus keeps PayGate's card token and the brand,
last 4 digits and expiry; never the card number.

**Monthly payments.** An hourly job (one API instance at a time) charges the
saved card on terminal 2 ("NON3DS", `PAYGATE_RECURRING_*`) when the paid month
is up, for the month that starts there. The owner gets an email and an in-app
note for each payment.

- **Not through:** the plan is past due (the business is still listed). The
  card is tried again 1, 3 and 5 days after the first failure, and the owner
  can pay with another card meanwhile. Still unpaid 7 days after the first
  failure: the plan is **paused**, and the business is hidden from clients and
  takes no new bookings (`User.billingPausedAt`, the same rule as a
  suspension) until a month is paid with a card. Its bookings and data are
  kept.
- **Price rise** (the introductory months ending): the owner is told 15 days
  before the first payment at the standard price. If that notice did not go
  out at least 14 days before, that month is charged at the old price.
- **Cancel:** nothing more is charged, the plan runs to the end of the paid
  month, then ends. "Keep my plan" undoes it until then. Cancelling with a
  month unpaid ends the plan at once (a paused business stays hidden until it
  starts a plan again).
- **Replace card:** the owner pays the next month on PayGate's page with the
  new card (the overdue one while past due, a month from today while paused);
  the new card replaces the saved one.
- **Saved cards are deleted at PayGate** when a plan ends, a card is replaced,
  the account is closed, or a director keeps the business free. A queue
  (`VaultDeletion`) retries for about two days; if PayGate still refuses, the
  team gets an alert to delete it by hand at map.paygate.co.za.

**Never charged twice.** A plan is claimed before its card is charged and never
charged while a payment for it is open. If PayGate cannot be reached in the
middle of a charge, the outcome is unknown: the payment is **flagged**, the
team is alerted, and that business is not charged again until someone checks
the transaction at map.paygate.co.za (by its `BS…` reference). A payment that
went through but could not be applied (for example a new card and the monthly
payment both paid the same month) is also flagged, not applied twice. The admin
console (Money → Subscriptions) shows how many are flagged; refund or apply each
by hand after checking it at PayGate.

It is offered only when all of these are true:

1. `SUBSCRIPTION_BILLING_ENABLED=true` in `/app/.env.production` (default off;
   while off, every card route for plans answers 404 and nothing is charged).
2. Plans are shown to businesses (admin console → Money → Subscriptions).
3. Both terminals are set: `PAYGATE_ID` / `PAYGATE_PASSWORD`, and
   `PAYGATE_RECURRING_ID` / `PAYGATE_RECURRING_PASSWORD` (below).
4. **PayVault is on for both terminals** at PayGate, and PayGate has
   confirmed in writing that a card saved on terminal 1 (with the first
   payment, 3D Secure) can be charged on terminal 2 (NON3DS,
   merchant-initiated, no CVV), and which terminal deletes it (the code
   deletes on terminal 1).

The PayHost formats themselves (saving a card with the first payment,
charging it each month, deleting it) are in `apps/api/src/services/paygate.js`
("vault" section), taken from PayHost's WSDL and checked on PayGate's test
gateway with its public test account and test cards: saving the card and
reading it back (VaultId, masked number, expiry, brand), a merchant-initiated
charge (PayGate refuses it on a 3D Secure terminal, which is why the monthly
payment uses NON3DS), and deleting a card. PayGate's public test account
without 3D Secure did not accept its documented password, so the first real
monthly charge is checked live (step below).

**First live check, before telling businesses:** one Bookplus-owned business
on a trial ending soon adds a real card (smallest plan price), and the first
monthly charge is watched in the API log and at map.paygate.co.za on the
NON3DS terminal. If PayGate answers that the token is unknown on that
terminal, the two terminals do not share the vault: switch
`SUBSCRIPTION_BILLING_ENABLED` off and ask PayGate to link them.

### Putting the NON3DS terminal on the server

Only when switching plans on. Run on the server; each `read -rs` asks for a
value without showing it, and nothing below prints it:

```
cd /app
[ -e .env.production.bak ] || cp -p .env.production .env.production.bak
read -rs -p 'NON3DS PGID: ' RID; echo
read -rs -p 'NON3DS Encryption Key: ' RKEY; echo
sed -i '/^PAYGATE_RECURRING_\(ID\|PASSWORD\)=/d' .env.production
{ [ -z "$(tail -c1 .env.production)" ] || echo; printf 'PAYGATE_RECURRING_ID=%s\nPAYGATE_RECURRING_PASSWORD=%s\n' "$RID" "$RKEY"; } >> .env.production
unset RID RKEY
grep -cE '^PAYGATE_RECURRING_(ID|PASSWORD)=.+' .env.production   # 2
chmod 600 .env.production
docker compose up -d --force-recreate server
```

If that terminal signs with a different key than its Encryption Key, add
`PAYGATE_RECURRING_ENCRYPTION_KEY` the same way. Remove `.env.production.bak`
with `shred -u` once the API is running.

PayGate's callbacks for plans go to `/api/subscriptions/paygate/notify` and
`/return` on `PAYGATE_CALLBACK_BASE_URL`. Each one is checked by its checksum
and then by asking PayGate, and applying a payment twice changes nothing.
Every step is in the financial audit log: `subscription.checkout_start`,
`first_payment`, `card_payment`, `renewal_start`, `renewal_payment`,
`payment_failed`, `paused`, `cancel`, `keep`, `ended`, `card_deleted`.

## Switching off again

Set `PAYMENTS_ENABLED=false` (and `paymentsEnabled: false` if the screens should
go too). New bookings are then paid at the appointment.

**Payments in progress:** while the flag is off, PayGate's callbacks to Bookplus
are refused, so a client paying at that moment would not be confirmed. Switch
off when no payment is in progress. If one was, switch back on briefly, or use
**Money → Payments → Ask PayGate** on it once payments are on again: that asks
PayGate what happened and applies it. Money already collected stays on the
businesses' balances and is paid out as normal.

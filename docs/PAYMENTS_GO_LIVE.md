# Plan payments: going live

The only card payments on Bookplus are **businesses paying for their Bookplus
plan** (a free trial, then a monthly subscription). Clients never pay by card
through Bookplus: they pay the business directly, and Bookplus takes no
commission. Plan payments are built and deployed, but **switched off**. This is
the list of everything that must be true before they are switched on, and how
to switch them on (and off again).

Nothing here is done by code alone: most items need the owner, PayGate or a
lawyer. Tick them off in the admin console as they are done: **Admin console →
Settings → Go-live checklist**. Each item there records who confirmed it, when,
and a note.

## 1. Launch gates (Settings → Go-live checklist)

| Gate | Who | What "done" means |
|---|---|---|
| PayGate approval | Owner | PayGate's **written** approval of recurring billing: PayVault enabled, and a card saved on terminal 1 can be charged on terminal 2 (and which terminal deletes it). |
| Prices approved | Owner | The owner has approved the Basic plan's prices (Settings → Plan prices). |
| Legal clearance | Owner | The legal position for charging businesses monthly is on record. |
| Terms reviewed | Lawyer | The lawyer has reviewed the plan clauses (section 2). |
| Live test passed | Builder + owner | Section 6 done on the live account. |

## 2. Legal text (lawyer)

Switch: `subscriptionBillingEnabled` in `packages/config/features.mjs` (off).
While off, the business terms keep only "we will tell you about any fee before
it applies". When on, they add:

- `terms.mjs`: business terms "Your Bookplus plan" (kept free, the trial,
  prices fixed at the trial, the first payment with 3D Secure, **the authority
  to charge the saved card every month until cancelled**, failed payments,
  14 days' notice of a price rise, cancelling, refunds of errors, deleting the
  saved card), and "Fees" pointing at it (no booking fee, no commission);
- `privacy.mjs` (business): the plan and the saved-card token, why, PayGate,
  how long;
- `notice.mjs` (business): "Paying for your Bookplus plan" (who is paid, the
  currency, the country, card security, where the cancelling and refund rules
  are: what PayGate checks on the website).

They are written to match what the code does (each clause notes the code it
rests on). Decisions marked `DECISION` in `terms.mjs` are built as written: the
7-day retry window and what pausing means, cancelling at the end of the paid
month with no part-month refunds, and deleting the saved card at PayGate when
the plan ends or the card is replaced. They are still the owner's decisions to
confirm. For the lawyer: the recurring-charge authority, no part-month refunds,
pausing for non-payment, replacing a card by paying the next month, VAT on the
plan price (Settings → Plan prices), how long financial records are kept ("for
as long as the law requires" until a period is confirmed; the proposal is 5
years, `ACCOUNTING_RECORDS_YEARS` in `apps/api/src/constants/retention.js`), and
whether to add any liability, indemnity or governing-law clause (removed in
September 2026 pending legal advice).

After the review, update the "last updated" dates (`TERMS_LAST_UPDATED`,
`PRIVACY_LAST_UPDATED`, `NOTICE_LAST_UPDATED`).

## 3. PayGate terminals

PayGate gives two terminals, each with a PGID, an Encryption Key and a login
for map.paygate.co.za:

- **"One time and tokenization"** (3D Secure, terminal 1): a business's first
  payment and any payment with a new card, which also saves the card.
- **"NON3DS"** (terminal 2): charging a business's saved card each month, with
  nobody present (`PAYGATE_RECURRING_*`, section 7).

The map.paygate.co.za logins are for people (transactions, refunds, settlement
reports), never for the server. Never paste a terminal's details into chat, a
ticket or the repository.

On the server, in `/app/.env.production`:

```
PAYGATE_ID=
PAYGATE_PASSWORD=
PAYGATE_CALLBACK_BASE_URL=https://api.bookplus.pro
MFA_ENCRYPTION_KEY=
```

- `PAYGATE_ID`: terminal 1's PGID.
- `PAYGATE_PASSWORD`: terminal 1's Encryption Key.
- `MFA_ENCRYPTION_KEY`: make it once with `openssl rand -hex 32`, before any
  admin turns on two-step sign-in, and never change it.

Optional: `MFA_SESSION_HOURS` (default 12) and `PAYGATE_ENCRYPTION_KEY` (below).

Reload the API so it reads the file (`docker compose restart` does not):

```
cd /app
docker compose up -d --force-recreate server
```

Then **check the connection**: admin console → Settings → Go-live checklist →
"Check the PayGate connection". It opens a N$5.00 test session at PayGate that
nobody pays and shows, check by check, whether PayGate accepts the ID and
password, signs with the key Bookplus checks, and can reach Bookplus. If it
says PayGate signs with a different key, add `PAYGATE_ENCRYPTION_KEY=<the
terminal's Encryption Key>`, reload the API and check again.

## 4. Switching on

1. `SUBSCRIPTION_BILLING_ENABLED=true` in `/app/.env.production`, then reload
   the API as above.
2. In the code: `packages/config/features.mjs` → `subscriptionBillingEnabled:
   true`, merged through a pull request (merging to main deploys). It adds the
   plan clauses to the legal pages.
3. Show plans to businesses: admin console → Money → Subscriptions.

## 5. How plan payments work

Off until `SUBSCRIPTION_BILLING_ENABLED=true`.

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
4. The three vault wire formats are filled in, in
   `apps/api/src/services/paygate.js` (the "vault" section: saving a card,
   charging a saved card, deleting a saved card), from PayGate's PayHost
   documentation, and checked against the test gateway with PayGate's public
   test credentials. Also to confirm with PayGate: a card saved on terminal 1
   can be charged on terminal 2, and which terminal deletes it. Until then
   nothing offers to save a card and nothing is charged.

## 6. Test run

1. **PayGate's test account** (the public PayHost test credentials from
   PayGate's documentation): a business starts its plan (approved card, then a
   declined one and "Try again"), a monthly charge goes through, a failed one
   is retried, the card is replaced, the plan is cancelled and kept.
2. **Live, small**: one real business pays its first month and one monthly
   charge with a real card; the payment is refunded at map.paygate.co.za and
   seen on the card statement.

Before launch: off-site backups running (`ops/backup/README.md`),
`ALERT_WEBHOOK_URL` set so payment errors reach the team, and at least two
admins with the money roles, each with two-step sign-in on.

## 7. Putting the NON3DS terminal on the server

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

Set `SUBSCRIPTION_BILLING_ENABLED=false` and reload the API. Nothing more is
charged and the card routes for plans answer 404. While it is off, PayGate's
callbacks for plans are refused, so switch off when no first payment is in
progress; a payment that was can be checked at map.paygate.co.za by its `BS…`
reference.

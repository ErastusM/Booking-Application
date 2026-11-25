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

PayGate set up two terminals. Each key is generated in PayGate's portal and
shown only once: copy it into a password manager, never into chat, a ticket
or the repository.

| Terminal | What Bookplus uses it for | Protocol | Keys |
|---|---|---|---|
| **"One time and tokenization"** (terminal 1, 3D Secure) | A business's first payment and any payment with a new card, which also saves the card (PayVault) | PayWeb 3 | its PayWeb 3 key |
| **"NON3DS"** (terminal 2) | Charging the saved card each month, with nobody present; deleting saved cards | PayHost | its PayHost key and its PayWeb 3 key |

On the server, in `/app/.env.production`:

| Setting | Value |
|---|---|
| `PAYGATE_ID` | terminal 1's PayGate ID |
| `PAYGATE_ENCRYPTION_KEY` | terminal 1's PayWeb 3 key |
| `PAYGATE_RECURRING_ID` | terminal 2's PayGate ID |
| `PAYGATE_RECURRING_PASSWORD` | terminal 2's PayHost key |
| `PAYGATE_RECURRING_ENCRYPTION_KEY` | terminal 2's PayWeb 3 key |
| `PAYGATE_CALLBACK_BASE_URL` | `https://api.bookplus.pro` |
| `MFA_ENCRYPTION_KEY` | made once with `openssl rand -hex 32`, before any admin turns on two-step sign-in; never changed |

Put the five PayGate values on the server with hidden prompts. Each
`read -rs` asks for a value without showing it, and nothing below prints it:

```
cd /app
[ -e .env.production.bak ] || cp -p .env.production .env.production.bak
read -rs -p 'Terminal 1 (One time and tokenization) PayGate ID: ' ID1; echo
read -rs -p 'Terminal 1 PayWeb 3 key: ' K1; echo
read -rs -p 'Terminal 2 (NON3DS) PayGate ID: ' ID2; echo
read -rs -p 'Terminal 2 PayHost key: ' P2; echo
read -rs -p 'Terminal 2 PayWeb 3 key: ' K2; echo
sed -i '/^PAYGATE_\(ID\|PASSWORD\|ENCRYPTION_KEY\|RECURRING_ID\|RECURRING_PASSWORD\|RECURRING_ENCRYPTION_KEY\)=/d' .env.production
{ [ -z "$(tail -c1 .env.production)" ] || echo; printf 'PAYGATE_ID=%s\nPAYGATE_ENCRYPTION_KEY=%s\nPAYGATE_RECURRING_ID=%s\nPAYGATE_RECURRING_PASSWORD=%s\nPAYGATE_RECURRING_ENCRYPTION_KEY=%s\n' "$ID1" "$K1" "$ID2" "$P2" "$K2"; } >> .env.production
unset ID1 K1 ID2 P2 K2
chmod 600 .env.production
grep -cE '^PAYGATE_(ID|ENCRYPTION_KEY|RECURRING_ID|RECURRING_PASSWORD|RECURRING_ENCRYPTION_KEY)=.+' .env.production   # 5
grep -E '^PAYGATE_CALLBACK_BASE_URL=' .env.production || echo 'PAYGATE_CALLBACK_BASE_URL=https://api.bookplus.pro' >> .env.production
docker compose up -d --force-recreate server
```

`docker compose restart` does not reload the file; the command above does.
Remove `.env.production.bak` with `shred -u` once the check below passes.

Then **check the connection**: admin console → Settings → Go-live checklist →
"Check the PayGate connection". Nothing is charged. It shows, check by check:

- terminal 1 opens a N$5.00 PayWeb 3 test session that nobody pays (it shows
  in PayGate's MAP as not done), signed with the key Bookplus checks, and
  Bookplus can read it back;
- PayHost accepts terminal 2's ID and PayHost key (Bookplus asks about a
  transaction that cannot exist);
- PayGate can reach Bookplus (only once `SUBSCRIPTION_BILLING_ENABLED=true`:
  until then the result address answers "not found"), and owners come straight
  back to their plan page.

## 4. Switching on

1. `SUBSCRIPTION_BILLING_ENABLED=true` in `/app/.env.production`, then reload
   the API as above.
2. In the code: `packages/config/features.mjs` → `subscriptionBillingEnabled:
   true`, merged through a pull request (merging to main deploys). It adds the
   plan clauses to the legal pages.
3. Show plans to businesses: admin console → Money → Subscriptions.

## 5. How plan payments work

Off until `SUBSCRIPTION_BILLING_ENABLED=true`. It follows the Business
Subscription Terms (November 2026): 60 days free, then N$79.99 for the first
paid month (46.67% off), then N$149.99 a month. These are the starting values
of a new installation (`PlatformSettings.DEFAULTS`); on the live server a
director sets them in the admin console (Settings → Plan prices), and each
business keeps the prices it registered with. The sign-up page shows them, with
the billing dates, once plans are shown to businesses
(`GET /api/subscriptions/plan`).

**Starting the plan.** A business on its free trial (or whose trial has ended,
or whose plan ended) presses **Account → Your plan → Add card and start plan**:
it pays its first month on PayGate's page with terminal 1 ("One time and
tokenization", the `PAYGATE_*` settings above, 3D Secure), and PayGate saves
the card in its vault. Adding a card early never shortens the trial: the paid
month starts when it ends. Bookplus keeps PayGate's card token and the brand,
last 4 digits and expiry; never the card number.

**Monthly payments.** An hourly job (one API instance at a time) charges the
saved card on terminal 2 ("NON3DS", `PAYGATE_RECURRING_*`) when the paid month
is up, for the month that starts there. The owner is reminded by email and
in the app 3 days before each payment (amount, date, card), and gets a receipt
for each one.

- **Not through:** the plan is past due (the business is still listed). The
  card is tried again 1, 2 and 4 days after the first failure, and the owner
  can pay with another card meanwhile. Still unpaid 5 days after the first
  failure (the grace period): the plan is **paused** (`User.billingPausedAt`):
  clients cannot make new online bookings with it, and its openings are left
  out of search, until the unpaid month is paid with a card. A pause does not
  cancel the plan or what is owed: the oldest unpaid month is paid first, then
  the saved (new) card is charged for any other months owed, one per hourly
  run. The business stays listed (its page
  says it isn't taking online bookings), keeps its dashboard, calendar,
  clients and booking history, and can still add bookings to its own
  calendar. Nothing is deleted.
- **The free trial ending:** the owner is reminded 7 days and 1 day before.
  If it ends with no month paid, new online bookings are paused the same way
  until the first month is paid. A plan that ends after a cancel is paused
  too, until a plan is started again.
- **Price rise** (the introductory month ending): the owner is told as soon
  as the introductory month is paid (up to 31 days before the first payment at
  the standard price). If that notice did not go out at least 14 days before,
  that month is charged at the old price. A revision of the price list only
  applies to new businesses; the terms promise 30 days' notice before a
  revised fee applies to an existing one, which would need building first.
- **Cancel:** nothing more is charged, the plan runs to the end of the paid
  month, then ends. "Keep my plan" undoes it until then. Cancelling with a
  month unpaid ends the plan at once (a paused business stays hidden until it
  starts a plan again).
- **Replace card:** the owner pays the next month on PayGate's page with the
  new card (the oldest unpaid one while past due or paused); the new card
  replaces the saved one.
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
3. Both terminals are set (section 3): `PAYGATE_ID` / `PAYGATE_ENCRYPTION_KEY`
   for terminal 1, and `PAYGATE_RECURRING_ID` / `PAYGATE_RECURRING_PASSWORD` /
   `PAYGATE_RECURRING_ENCRYPTION_KEY` for terminal 2.
4. **PayVault is on** at PayGate, and a card saved on terminal 1 (with the
   first payment, 3D Secure) can be charged on terminal 2 (NON3DS,
   merchant-initiated, no CVV). Saved cards are deleted through PayHost on
   terminal 2 (terminal 1 has PayWeb 3 only).

The formats are in `apps/api/src/services/paygate.js`, checked on PayGate's
test gateway with its public test account and test cards:
- terminal 1, PayWeb 3 (2026-11-25): opening a session that saves the card
  (`VAULT=1`), PayGate's signature on it, and reading the result back
  (`VAULT_ID`, the masked number in `PAYVAULT_DATA_1`, the expiry in
  `PAYVAULT_DATA_2`, the brand in `PAY_METHOD_DETAIL`). The test account takes
  ZAR only; the live terminal takes N$.
- terminal 2, PayHost (2026-11-13): a merchant-initiated charge on a saved card
  (PayGate refuses it on a 3D Secure terminal, which is why the monthly payment
  uses NON3DS), deleting a card, and the login check (code 401 for a right
  key, 11 for a wrong one).

PayGate's public test accounts could not be used for a card saved on one
terminal and charged on the other, so the first real monthly charge is checked
live (step below).

**First live check, before telling businesses:** one Bookplus-owned business
on a trial ending soon adds a real card (smallest plan price), and the first
monthly charge is watched in the API log and at map.paygate.co.za on the
NON3DS terminal. If PayGate answers that the token is unknown on that
terminal, the two terminals do not share the vault: switch
`SUBSCRIPTION_BILLING_ENABLED` off and ask PayGate to link them.

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

## 7. Callbacks and the audit log

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

// Alphabetical order for client lists — the New Appointment "Select a client"
// picker, the Clients tab and the Wallet client balances all sort through here,
// so the same client can never sit in a different place from one list to the
// next.
//
// The key is the name the owner reads, trimmed. sensitivity 'base' makes it
// case- and accent-insensitive ("amber" sits with "Amber", "Émile" with
// "Emile"), and numeric puts "Client 2" before "Client 10". Ties break by email
// (walk-ins have none, so they come first) and then by id, so the order is
// stable between renders. One Collator, built once: cheaper than localeCompare
// per comparison on a roster of a few hundred.
//
// A row with no name (a wallet whose client account was deleted reads "—")
// goes to the END, not the top: "" collates before every name, which would put
// a blank row above "Adriel".
//
// Works on any row shaped { customer: { _id, name, email } } — the CRM client
// roll-up and the wallet rows share it.

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const nameOf = (row) => String(row?.customer?.name || '').trim();

export const compareClients = (a, b) =>
    (!nameOf(a) - !nameOf(b))
    || collator.compare(nameOf(a), nameOf(b))
    || collator.compare(String(a?.customer?.email || ''), String(b?.customer?.email || ''))
    || String(a?.customer?._id ?? '').localeCompare(String(b?.customer?._id ?? ''));

// A sorted COPY — never sorts the caller's (React state) array in place.
export const sortClients = (rows) => [...(rows || [])].sort(compareClients);

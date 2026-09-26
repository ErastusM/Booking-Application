// Product feature switches shared by both apps. The API reads the matching
// environment variable (apps/api/src/constants/features.js); an API unit test
// keeps the two defaults equal.
//
// walletEnabled — the prepaid client wallet (top-ups, proofs of payment, paying
// from the wallet, gift cards, expiry). OFF on the owner's instruction
// (September 2026): all clients pay the business in cash at the appointment.
// While off, both apps show "coming soon", and any balance that already exists
// is shown read-only (never hidden, never deleted). To switch the wallet back on:
// set this to true AND WALLET_ENABLED=true for the API.
export const FEATURES = {
    walletEnabled: false,
};

export const WALLET_COMING_SOON_LINE = 'Pay at your appointment for now.';

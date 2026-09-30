// Product feature switches shared by both apps. The API reads the matching
// environment variable (apps/api/src/constants/features.js); an API unit test
// keeps the two defaults equal.
//
// walletEnabled — the prepaid client wallet (top-ups, proofs of payment, paying
// from the wallet, gift cards, expiry). OFF on the owner's instruction
// (September 2026): all clients pay the business at the appointment. While off,
// neither app mentions it (no menu item, no page, nothing in the legal text);
// balances already recorded are kept in the database, never deleted. To switch
// the wallet back on: set this to true AND WALLET_ENABLED=true for the API.
//
// membershipsEnabled — membership plans / session packages a business sells
// and clients redeem. OFF on the owner's instruction (September 2026) for the
// payment provider's review. While off, the business app has no Memberships
// menu item or screen, and the API's /api/packages routes answer 404. To switch
// it back on: set this to true AND MEMBERSHIPS_ENABLED=true for the API.
export const FEATURES = {
    walletEnabled: false,
    membershipsEnabled: false,
};

export const WALLET_COMING_SOON_LINE = 'Pay at your appointment for now.';

/**
 * account-doctor — inspect (and safely fix) the accounts behind one email.
 *
 * One email may hold TWO User documents: a customer one and a business one
 * ({email, accountType} is the unique index). Login problems of the shape
 * "it keeps taking me to the customer side" are almost always about which of
 * those two exists and which password opens it — so LOOK before touching
 * anything.
 *
 *   node scripts/account-doctor.js someone@example.com
 *   node scripts/account-doctor.js someone@example.com --detach-customer
 *   node scripts/account-doctor.js someone@example.com --delete-customer
 *
 * --detach-customer  Moves the CUSTOMER account to <local>+customer@<domain>.
 *                    The email then holds only the business account, so signing
 *                    in on the website hands them straight to the business app.
 *                    Nothing is destroyed and it is reversible (run again with
 *                    the new address and --restore-email <old>).
 *
 * --delete-customer  Permanently removes the CUSTOMER document. Refused unless
 *                    a separate business account exists AND the customer
 *                    account has nothing attached — deleteUser does not cascade,
 *                    so anything pointing at it (their own bookings at other
 *                    businesses, wallets, reviews) would be orphaned, not
 *                    cleaned up. --force overrides, and prints what it orphans.
 *
 * --restore-email x  Sets the matched account's email back to x.
 *
 * Run it on the API host so it picks up MONGODB_URI, e.g.
 *   docker compose exec server node scripts/account-doctor.js you@example.com
 */
require('dotenv').config();
const mongoose = require('mongoose');

const [, , rawEmail, ...flags] = process.argv;
const has = (f) => flags.includes(f);
const valueOf = (f) => {
    const i = flags.indexOf(f);
    return i === -1 ? null : flags[i + 1];
};

if (!rawEmail || rawEmail.startsWith('--')) {
    console.error('Usage: node scripts/account-doctor.js <email> [--detach-customer|--delete-customer|--restore-email <email>] [--force]');
    process.exit(1);
}
const email = rawEmail.trim().toLowerCase();

const MODELS = [
    ['User', '../apps/api/src/models/User'],
    ['Appointment', '../apps/api/src/models/Appointment'],
    ['Service', '../apps/api/src/models/Service'],
    ['Availability', '../apps/api/src/models/Availability'],
    ['TeamMember', '../apps/api/src/models/TeamMember'],
    ['Review', '../apps/api/src/models/Review'],
    ['Wallet', '../apps/api/src/models/Wallet'],
    ['ProviderWallet', '../apps/api/src/models/ProviderWallet'],
];

// Works whether run from the repo root or from inside apps/api.
const load = (path) => {
    try { return require(path); } catch { return require(path.replace('../apps/api/src/models/', './src/models/')); }
};

(async () => {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) { console.error('MONGODB_URI is not set — run this on the API host.'); process.exit(1); }
    await mongoose.connect(uri);

    const M = {};
    for (const [name, path] of MODELS) M[name] = load(path);

    const users = await M.User.find({ email }).sort({ createdAt: 1 });
    if (!users.length) {
        console.log(`No account found for ${email}.`);
        await mongoose.disconnect();
        return;
    }

    console.log(`\n${users.length} account${users.length > 1 ? 's' : ''} on ${email}\n${'─'.repeat(64)}`);

    const summaries = [];
    for (const u of users) {
        const asCustomer = await M.Appointment.countDocuments({ customer: u._id });
        const asProvider = await M.Appointment.countDocuments({ provider: u._id });
        const services = await M.Service.countDocuments({ provider: u._id });
        const availability = await M.Availability.countDocuments({ provider: u._id });
        const team = await M.TeamMember.countDocuments({ provider: u._id });
        const reviews = await M.Review.countDocuments({ customer: u._id });
        const wallets = await M.Wallet.countDocuments({ customer: u._id });
        const providerWallet = await M.ProviderWallet.findOne({ provider: u._id });

        const s = {
            id: String(u._id),
            role: u.role,
            accountType: u.accountType,
            signIn: u.provider === 'google' ? 'Google' : (u.password ? 'password' : 'NO PASSWORD'),
            googleId: u.googleId || null,
            verified: u.isVerified === true,
            active: u.isActive !== false,
            suspended: u.isActive === false && !u.deactivatedAt,
            created: u.createdAt,
            lastLogin: u.lastLoginAt || null,
            attached: { asCustomer, asProvider, services, availability, team, reviews, wallets, providerWalletBalance: providerWallet?.balance || 0 },
            doc: u,
        };
        summaries.push(s);

        console.log(`
  ${s.accountType === 'business' ? 'BUSINESS' : 'CUSTOMER'}  (${s.role})   id ${s.id}
    name           ${u.name}
    sign-in        ${s.signIn}${s.googleId ? `  google:${s.googleId}` : ''}
    verified       ${s.verified}${s.verified ? '' : '   ← unverified accounts are not offered the destination choice'}
    active         ${s.active}${s.suspended ? '   ← ADMIN-SUSPENDED' : ''}
    created        ${s.created}
    last login     ${s.lastLogin || 'never'}
    attached data  bookings made: ${asCustomer} · bookings received: ${asProvider} · services: ${services}
                   availability: ${availability} · team: ${team} · reviews: ${reviews}
                   client wallets: ${wallets} · provider wallet balance: ${s.attached.providerWalletBalance}`);
    }

    const customer = summaries.find((s) => s.accountType === 'customer');
    const business = summaries.find((s) => s.accountType === 'business');

    console.log(`\n${'─'.repeat(64)}\nDiagnosis`);
    if (customer && business) {
        const same = customer.signIn === 'password' && business.signIn === 'password'
            ? '(run a login to see whether one password opens both)'
            : '';
        console.log(`  Both profiles exist. Signing in on the website should offer the choice ${same}`);
        console.log('  If it does not, the deployed build predates the existence-based chooser.');
    } else if (business && !customer) {
        console.log('  Business only. The website should hand this person straight to the business app.');
        console.log('  Nothing to detach or delete — the customer account they think they have does not exist.');
    } else if (customer && !business) {
        console.log('  CUSTOMER ONLY — there is no separate business account on this email.');
        console.log('  Landing on the customer site is correct. If they run a business here, it was either');
        console.log('  created on a different email, or this single document WAS converted to a provider by');
        console.log('  the old "List your business" (check the role above: a lone role=provider document IS');
        console.log('  the business — deleting it would destroy the business).');
    }

    // ── Actions ──────────────────────────────────────────────────────────────
    const restore = valueOf('--restore-email');
    if (restore) {
        const target = users[0];
        await M.User.updateOne({ _id: target._id }, { $set: { email: restore.trim().toLowerCase() } });
        console.log(`\nRestored ${target._id} to ${restore}.`);
    } else if (has('--detach-customer')) {
        if (!customer) {
            console.log('\nRefused: there is no customer account on this email.');
        } else if (!business) {
            console.log('\nRefused: there is no business account, so detaching would lock this person out entirely.');
        } else {
            const [local, domain] = email.split('@');
            const moved = `${local}+customer@${domain}`;
            await M.User.updateOne({ _id: customer.doc._id }, { $set: { email: moved } });
            console.log(`\nCustomer account moved to ${moved}.`);
            console.log(`${email} now holds only the business account, so the website will hand them to the business app.`);
            console.log(`Reverse with:  node scripts/account-doctor.js ${moved} --restore-email ${email}`);
        }
    } else if (has('--delete-customer')) {
        if (!customer) {
            console.log('\nRefused: there is no customer account on this email.');
        } else if (!business) {
            console.log('\nREFUSED: no separate business account exists. Deleting this document would destroy');
            console.log('the only account on this email — and if its role is provider, the business with it.');
        } else {
            const a = customer.attached;
            const orphans = a.asCustomer + a.reviews + a.wallets;
            if (orphans > 0 && !has('--force')) {
                console.log(`\nREFUSED: this customer account has ${a.asCustomer} booking(s), ${a.reviews} review(s) and ${a.wallets} wallet(s).`);
                console.log('Deleting does NOT cascade, so those rows would point at a missing user and show as');
                console.log('blank names on other businesses\' calendars. Use --detach-customer instead (keeps');
                console.log('everything, same end result), or pass --force if you truly want them orphaned.');
            } else {
                await M.User.deleteOne({ _id: customer.doc._id });
                console.log(`\nDeleted the customer account (${customer.id}).`);
                if (orphans > 0) console.log(`Orphaned: ${a.asCustomer} booking(s), ${a.reviews} review(s), ${a.wallets} wallet(s).`);
                console.log(`${email} now holds only the business account.`);
            }
        }
    } else {
        console.log('\nNo changes made (inspection only). Add --detach-customer or --delete-customer to act.');
    }

    await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });

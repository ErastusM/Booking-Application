/**
 * account-doctor — inspect (and safely fix) the accounts behind one email.
 *
 * One email may hold TWO User documents: a customer one and a business one
 * ({email, accountType} is the unique index). Login problems of the shape
 * "it keeps taking me to the customer side" are almost always about which of
 * those two exists and which credential opens it — so LOOK before touching
 * anything.
 *
 * Run inside the server container (working dir is /app):
 *   docker compose exec server node scripts/account-doctor.js someone@example.com
 *   docker compose exec server node scripts/account-doctor.js someone@example.com --detach-customer
 *   docker compose exec server node scripts/account-doctor.js someone@example.com --delete-customer
 *   docker compose exec server node scripts/account-doctor.js someone+customer@example.com --restore-email someone@example.com
 *
 * --detach-customer  Moves the CUSTOMER account to <local>+customer@<domain>.
 *                    The email then holds only the business account, so signing
 *                    in on the website hands them straight to the business app.
 *                    Nothing is destroyed and it reverses with --restore-email.
 *
 * --delete-customer  Permanently removes the CUSTOMER document. Refused unless a
 *                    separate business account exists AND the customer account
 *                    has nothing attached — the admin delete does not cascade,
 *                    so anything pointing at it (their own bookings at other
 *                    businesses, wallets, reviews) would be orphaned, not
 *                    cleaned up. --force overrides and prints what it orphans.
 *
 * --restore-email x  Sets the matched account's email back to x.
 *
 * Inspection only unless an action flag is given: with no flag it changes
 * nothing.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../src/models/User');
const Appointment = require('../src/models/Appointment');
const Service = require('../src/models/Service');
const Availability = require('../src/models/Availability');
const TeamMember = require('../src/models/TeamMember');
const Review = require('../src/models/Review');
const Wallet = require('../src/models/Wallet');
const ProviderWallet = require('../src/models/ProviderWallet');

const [, , rawEmail, ...flags] = process.argv;
const has = (f) => flags.includes(f);
const valueOf = (f) => {
    const i = flags.indexOf(f);
    return i === -1 ? null : flags[i + 1];
};

if (!rawEmail || rawEmail.startsWith('--')) {
    console.error('Usage: node scripts/account-doctor.js <email> [--detach-customer | --delete-customer | --restore-email <email>] [--force]');
    process.exit(1);
}
const email = rawEmail.trim().toLowerCase();

const attachedTo = async (u) => {
    const [asCustomer, asProvider, services, availability, team, reviews, wallets, providerWallet] = await Promise.all([
        Appointment.countDocuments({ customer: u._id }),
        Appointment.countDocuments({ provider: u._id }),
        Service.countDocuments({ provider: u._id }),
        Availability.countDocuments({ provider: u._id }),
        TeamMember.countDocuments({ provider: u._id }),
        Review.countDocuments({ customer: u._id }),
        Wallet.countDocuments({ customer: u._id }),
        ProviderWallet.findOne({ provider: u._id }),
    ]);
    return { asCustomer, asProvider, services, availability, team, reviews, wallets, providerWalletBalance: providerWallet?.balance || 0 };
};

(async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error('MONGODB_URI is not set — run this inside the server container.'); process.exit(1); }
    await mongoose.connect(uri);

    const users = await User.find({ email }).sort({ createdAt: 1 });
    if (!users.length) {
        console.log(`\nNo account found for ${email}.`);
        await mongoose.disconnect();
        process.exit(0);
    }

    console.log(`\n${users.length} account${users.length > 1 ? 's' : ''} on ${email}\n${'─'.repeat(66)}`);

    const summaries = [];
    for (const u of users) {
        const attached = await attachedTo(u);
        const s = {
            doc: u,
            id: String(u._id),
            accountType: u.accountType,
            signIn: u.provider === 'google' ? 'Google' : (u.password ? 'password' : 'NO PASSWORD'),
            suspended: u.isActive === false && !u.deactivatedAt,
            attached,
        };
        summaries.push(s);

        console.log(`
  ${s.accountType === 'business' ? 'BUSINESS' : 'CUSTOMER'}  (role: ${u.role})   id ${s.id}
    name           ${u.name}
    sign-in        ${s.signIn}${u.googleId ? `  google:${u.googleId}` : ''}
    verified       ${u.isVerified === true}${u.isVerified === true ? '' : '   ← unverified: not offered the destination choice'}
    active         ${u.isActive !== false}${s.suspended ? '   ← ADMIN-SUSPENDED' : ''}
    created        ${u.createdAt}
    last login     ${u.lastLoginAt || 'never'}
    attached       bookings made: ${attached.asCustomer} · bookings received: ${attached.asProvider} · services: ${attached.services}
                   availability: ${attached.availability} · team: ${attached.team} · reviews: ${attached.reviews}
                   client wallets: ${attached.wallets} · provider-wallet balance: ${attached.providerWalletBalance}`);
    }

    const customer = summaries.find((s) => s.accountType === 'customer');
    const business = summaries.find((s) => s.accountType === 'business');

    console.log(`\n${'─'.repeat(66)}\nDiagnosis`);
    if (customer && business) {
        console.log('  Both profiles exist. Signing in on the website should offer the choice.');
        console.log('  If it does not, the deployed build predates the existence-based chooser.');
    } else if (business && !customer) {
        console.log('  Business only. The website should hand this person straight to the business app.');
        console.log('  Nothing to detach or delete — the customer account they think they have does not exist.');
    } else {
        console.log('  CUSTOMER ONLY — there is NO separate business account on this email.');
        console.log('  If the role above is "provider", this single document IS the business (the old');
        console.log('  "List your business" converted it in place). Deleting it would DESTROY the business,');
        console.log('  with its services, hours and team. Do not delete — this is the conversion bug.');
    }

    // ── Actions ──────────────────────────────────────────────────────────────
    const restore = valueOf('--restore-email');
    if (restore) {
        await User.updateOne({ _id: users[0]._id }, { $set: { email: restore.trim().toLowerCase() } });
        console.log(`\nRestored ${users[0]._id} to ${restore}.`);
    } else if (has('--detach-customer')) {
        if (!customer) {
            console.log('\nRefused: there is no customer account on this email.');
        } else if (!business) {
            console.log('\nRefused: there is no business account, so detaching would lock this person out entirely.');
        } else {
            const [local, domain] = email.split('@');
            const moved = `${local}+customer@${domain}`;
            await User.updateOne({ _id: customer.doc._id }, { $set: { email: moved } });
            console.log(`\nCustomer account moved to ${moved}.`);
            console.log(`${email} now holds only the business account → the website hands them to the business app.`);
            console.log(`Reverse with:  docker compose exec server node scripts/account-doctor.js ${moved} --restore-email ${email}`);
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
                console.log('everything, same end result), or pass --force to orphan them anyway.');
            } else {
                await User.deleteOne({ _id: customer.doc._id });
                console.log(`\nDeleted the customer account (${customer.id}).`);
                if (orphans > 0) console.log(`Orphaned: ${a.asCustomer} booking(s), ${a.reviews} review(s), ${a.wallets} wallet(s).`);
                console.log(`${email} now holds only the business account.`);
            }
        }
    } else {
        console.log('\nNo changes made (inspection only). Add --detach-customer or --delete-customer to act.');
    }

    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

/**
 * Turn off two-step sign-in for one admin account, from the server — for when
 * no other director can do it in the console (Money → Admins), e.g. the only
 * admin lost their phone and recovery codes, or MFA_ENCRYPTION_KEY /
 * JWT_SECRET changed and the stored secrets can no longer be read.
 *
 * Signs the account out everywhere. They set two-step sign-in up again from
 * the Money tab. Recorded in the financial audit log as done by the system.
 *
 * Run locally:   node scripts/reset_admin_mfa.js admin@bookplus.pro "Lost phone"
 * In Docker:     docker compose exec server node scripts/reset_admin_mfa.js admin@bookplus.pro "Lost phone"
 * List admins:   docker compose exec server node scripts/reset_admin_mfa.js --list
 * Shut one out:  docker compose exec server node scripts/reset_admin_mfa.js --lock <id from --list> "Unknown admin"
 *   (suspends the account and signs it out everywhere; for an admin nobody
 *   recognises, e.g. after a signing key leaked — docs/ROTATING_SECRETS.md).
 *   By id, never by email: whoever made an unknown admin chose its email, and
 *   an email can hold characters a shell would run.
 */

async function resetAdminMfa(email, reason) {
    const User = require('../src/models/User');
    const { recordFinance } = require('../src/utils/financeAudit');
    const admin = await User.findOne({ email: String(email || '').trim().toLowerCase(), role: 'admin' }).select('email mfa');
    if (!admin) return { ok: false, message: 'No admin account with that email.' };
    await User.updateOne({ _id: admin._id }, { $unset: { mfa: '' }, $inc: { tokenVersion: 1 }, $set: { refreshTokenJtis: [] } });
    await recordFinance({ actor: null, action: 'security.mfa_reset', reference: admin.email, reason: `Server script: ${reason}` });
    return { ok: true, message: `Two-step sign-in reset for ${admin.email}. They are signed out.` };
}

/** Every admin account, whether its two-step sign-in is on, and whether it is suspended. */
async function listAdmins() {
    const User = require('../src/models/User');
    const admins = await User.find({ role: 'admin' }).select('email mfa.enabled isActive').sort({ email: 1 }).lean();
    return admins.map((a) => ({ id: String(a._id), email: a.email, twoStep: !!a.mfa?.enabled, suspended: a.isActive === false }));
}

/**
 * Suspend an admin account and sign it out everywhere. It stays an admin so it
 * can be reviewed and removed in the console; suspended, it cannot sign in.
 * deactivatedAt is cleared because signing in reactivates a self-deactivated
 * account. The main admin (ADMIN_EMAIL) is never locked.
 */
async function lockAdmin(id, reason) {
    const User = require('../src/models/User');
    const FinanceRequest = require('../src/models/FinanceRequest');
    const { recordFinance } = require('../src/utils/financeAudit');
    if (!/^[0-9a-f]{24}$/i.test(String(id || ''))) return { ok: false, message: 'Give the id from --list (24 characters).' };
    const admin = await User.findOne({ _id: id, role: 'admin' }).select('email').lean();
    if (!admin) return { ok: false, message: 'No admin account with that id.' };
    if (admin.email === String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()) {
        return { ok: false, message: 'That is the main admin (ADMIN_EMAIL). Not locked.' };
    }
    await User.updateOne(
        { _id: admin._id },
        { $set: { isActive: false, deactivatedAt: null, refreshTokenJtis: [] }, $inc: { tokenVersion: 1 } },
    );
    await recordFinance({ actor: null, action: 'security.admin_locked', reference: admin.email, reason: `Server script: ${reason}` });
    // A request they prepared could still be approved by someone else.
    const waiting = await FinanceRequest.countDocuments({ preparedBy: admin._id, status: 'pending' });
    const note = waiting ? ` ${waiting} money request(s) they prepared are still waiting: reject them in the console (Money, Approvals).` : '';
    return { ok: true, message: `Admin ${id} is suspended and signed out.${note}`, waiting };
}

module.exports = { resetAdminMfa, listAdmins, lockAdmin };

if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const [email, ...why] = process.argv.slice(2);
        const reason = why.join(' ').trim();
        if (email === '--list') {
            const uri = process.env.MONGODB_URI;
            if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
            await mongoose.connect(uri);
            const admins = await listAdmins();
            for (const a of admins) console.log(`${a.id}  ${a.email}  two-step ${a.twoStep ? 'on' : 'off'}${a.suspended ? '  SUSPENDED' : ''}`);
            if (!admins.length) console.log('No admin accounts.');
            await mongoose.disconnect();
            process.exit(0);
        }
        if (email === '--lock') {
            const [target, ...lockWhy] = why;
            const lockReason = lockWhy.join(' ').trim();
            if (!target || !lockReason) { console.error('Usage: node scripts/reset_admin_mfa.js --lock <admin id from --list> "<reason>"'); process.exit(1); }
            const uri = process.env.MONGODB_URI;
            if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
            await mongoose.connect(uri);
            const r = await lockAdmin(target, lockReason);
            console.log(r.message);
            await mongoose.disconnect();
            process.exit(r.ok ? 0 : 1);
        }
        if (!email || !reason) { console.error('Usage: node scripts/reset_admin_mfa.js <admin email> "<reason>"'); process.exit(1); }
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
        await mongoose.connect(uri);
        const r = await resetAdminMfa(email, reason);
        console.log(r.message);
        await mongoose.disconnect();
        process.exit(r.ok ? 0 : 1);
    })().catch((err) => { console.error(err); process.exit(1); });
}

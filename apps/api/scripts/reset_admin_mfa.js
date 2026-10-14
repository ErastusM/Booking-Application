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

module.exports = { resetAdminMfa };

if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const [email, ...why] = process.argv.slice(2);
        const reason = why.join(' ').trim();
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

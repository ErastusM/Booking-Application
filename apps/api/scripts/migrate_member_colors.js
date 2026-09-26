/**
 * One-off migration — safe to run on every deploy (idempotent).
 *
 * Give every team member their own calendar colour.
 *
 * TeamMember.color used to default to the brand orange (#f03e16) — which is the
 * colour of the OWNER's own bookings. So on the owner's calendar, the staff
 * filter and the Staff lanes, every member looked exactly like the owner. New
 * members are now given a colour from the member palette (utils/memberColors)
 * when they are added; this recolours the ones that already exist.
 *
 * Per business, it recolours ONLY members whose colour is missing or is the
 * orange default (any case). Every other colour is one the owner picked and is
 * never changed — and those colours count as taken, so nobody is handed a
 * colour a colleague already has while a free one remains.
 *
 * Members are recoloured in the order they joined (createdAt): active members
 * first, so the people on the calendar today get the distinct colours; archived
 * or paused ones after. Once all ten palette colours are in use it cycles, the
 * least-used colour first.
 *
 * A re-run finds nothing missing or orange, so it writes nothing. Every change
 * is printed (business, member, old → new).
 *
 * Runs AFTER migrate_team_colors.js, which turns the even older gold default
 * into orange — so those members are picked up here in the same deploy.
 *
 * Run locally:   node scripts/migrate_member_colors.js
 * In Docker:     docker compose exec -T server node scripts/migrate_member_colors.js
 */
const { MEMBER_PALETTE, isUnsetColor, nextMemberColor } = require('../src/utils/memberColors');

const paletteName = (hex) => (MEMBER_PALETTE.find((c) => c.hex === hex) || {}).name || hex;

async function migrateMemberColors() {
    const TeamMember = require('../src/models/TeamMember');
    const User = require('../src/models/User');

    // Businesses with at least one member still missing a colour or on orange.
    const unset = { $or: [{ color: { $exists: false } }, { color: null }, { color: '' }, { color: { $regex: /^\s*#f03e16\s*$/i } }] };
    const providerIds = await TeamMember.distinct('provider', unset);

    const changes = [];
    for (const providerId of providerIds) {
        const members = await TeamMember.find({ provider: providerId })
            .select('name color isActive createdAt').sort({ createdAt: 1, _id: 1 }).lean();

        // Colours the owner chose for active members are taken from the start.
        const used = members.filter((m) => m.isActive !== false && !isUnsetColor(m.color)).map((m) => m.color);
        const todo = [
            ...members.filter((m) => m.isActive !== false && isUnsetColor(m.color)),
            ...members.filter((m) => m.isActive === false && isUnsetColor(m.color)),
        ];
        if (!todo.length) continue;

        const owner = await User.findById(providerId).select('name businessProfile.businessName').lean();
        const business = owner?.businessProfile?.businessName || owner?.name || String(providerId);

        for (const m of todo) {
            const color = nextMemberColor(used);
            // Guarded on the value we read, so a colour the owner saves while this
            // runs is never overwritten.
            const res = await TeamMember.updateOne(
                { _id: m._id, color: m.color === undefined ? { $exists: false } : m.color },
                { $set: { color } },
            );
            if (!res.modifiedCount) continue;
            if (m.isActive !== false) used.push(color);
            changes.push({
                provider: String(providerId), business, member: String(m._id), name: m.name,
                from: m.color || null, to: color, archived: m.isActive === false,
            });
        }
    }
    return { recolored: changes.length, changes };
}

module.exports = { migrateMemberColors, paletteName };

// CLI entry point (skipped when required by tests)
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
        await mongoose.connect(uri);
        console.log('Connected.');
        const { recolored, changes } = await migrateMemberColors();
        console.log(`Gave ${recolored} team member(s) their own calendar colour (was missing or the owner's orange).`);
        // Bounded: a large platform must not flood the deploy log.
        changes.slice(0, 200).forEach((c) => {
            console.log(`  ${c.business} — ${c.name}${c.archived ? ' (archived/paused)' : ''}: ${c.from || 'none'} → ${paletteName(c.to)} ${c.to}  [member ${c.member}]`);
        });
        if (changes.length > 200) console.log(`  …and ${changes.length - 200} more.`);
        await mongoose.disconnect();
        process.exit(0);
    })().catch((err) => { console.error(err); process.exit(1); });
}

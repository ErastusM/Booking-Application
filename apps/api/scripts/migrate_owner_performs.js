/**
 * One-off migration — safe to run on every deploy (idempotent).
 *
 * Decide, for every service that predates Service.ownerPerforms, whether the
 * OWNER offers it.
 *
 * The owner used to be assumed to offer the whole catalogue. But since
 * 2026-09-17 (#213) a team member can add a service they perform themselves,
 * and since 2026-09-25 (#217) the owner can add one for a member from the Team
 * screen. Both write an ordinary catalogue row, priced at the MEMBER's typed
 * price, with nothing marking it as the member's. So every one of those showed
 * under the owner's tile at the member's price — a driver's N$20 000 "Long trip"
 * above the owner's N$70 trim — fed the business's "Starting at", and could be
 * booked with the owner.
 *
 * New rows now record ownerPerforms when they are created. This decides the old
 * ones from the only signals the data holds, conservatively:
 *
 *   TEAM ONLY (ownerPerforms:false) when the row was plainly made by one of the
 *   two "a member's own service" paths:
 *     A. a team member added it for themselves (POST /team/mine/services):
 *        created after #213 by that business's staff account, still on that
 *        same person's own services list, in the exact shape that path writes
 *        (no category, options or add-ons; description = the name) — and the
 *        person cannot edit the business menu, so the catalogue could not have
 *        made it.
 *     B. a team member who cannot edit the menu added it for one colleague from
 *        the Team screen (POST /team/:id/services): created after #217, held by
 *        exactly that one member, who performs only their own list and whose own
 *        price/minutes for it are the values the row was created with.
 *
 *   The owner, and any member who can edit the menu, could equally have made
 *   the row as a menu item: the menu form with no description writes the same
 *   shape (no category, description = name). Such rows are NEVER switched off
 *   — they stay the owner's and are listed "please confirm".
 *
 *   OWNER KEEPS IT (ownerPerforms:true) for everything else. That includes every
 *   row created before members could add services at all, and every row where
 *   the evidence is partial — those are listed as "please confirm" so the owner
 *   can switch "I offer this" off in the catalogue if it was never theirs.
 *   Erring this way is deliberate: turning a service off wrongly would stop
 *   clients booking the owner for something they do; leaving it on is exactly
 *   today's behaviour, and the owner can now change it in one tap.
 *
 * Only rows with no decision yet are touched, so a re-run writes nothing and an
 * owner's own choice is never overwritten. Appointments are never modified:
 * upcoming bookings clients made WITH THE OWNER for a service that is now team
 * only are listed, so the owner can hand them to the member (or switch the
 * service back on).
 *
 * Every decision is printed (business, service, outcome, why), and the ids made
 * team-only are printed as a one-line rollback.
 *
 * Run locally:   node scripts/migrate_owner_performs.js [--dry-run]
 * In Docker:     docker compose exec -T server node scripts/migrate_owner_performs.js
 */

// #213 "A member can add the service they actually perform" merged at
// 2026-09-17T19:11:57Z. Nothing created before it can be a member's own
// service — no path existed. (Merge time, not deploy time: being generous
// here only admits rows the shape checks below still have to pass.)
const MEMBER_SELF_ADD_SINCE = new Date('2026-09-17T19:11:57.000Z');
// #217 "A team member's services are their own, on the owner's screen too"
// (the Team card's "Add a service <member> offers") merged 2026-09-25T16:18:56Z.
const OWNER_ADD_FOR_MEMBER_SINCE = new Date('2026-09-25T16:18:56.000Z');

const UNDECIDED = { $in: [null] }; // absent or null

const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'unknown date');
const firstName = (n) => String(n || 'a team member').trim().split(/\s+/)[0];

// The exact shape addServiceForMember writes: no category/options/add-ons, and
// the description defaulted to the name (neither business screen sends one).
const memberPathShape = (s) => !s.category
    && !(s.options || []).length
    && !(s.addOns || []).length
    && String(s.description || '').trim() === String(s.name || '').trim();

const listsService = (m, sid) => (m.services || []).some((id) => String(id) === sid);
const overrideOf = (m, sid) => (m.serviceOverrides || []).find((o) => String(o.service) === sid) || null;

// Does this member's own price/minutes for the service equal the values the row
// was created with? addServiceForMember writes both from the same typed input,
// so a match is that path's fingerprint; a later price change breaks it.
const typedHere = (m, s) => {
    const ov = m ? overrideOf(m, String(s._id)) : null;
    return !!ov && (ov.price != null || ov.duration != null)
        && (ov.price == null || ov.price === s.price)
        && (ov.duration == null || ov.duration === s.duration);
};

/**
 * Classify one undecided service. Returns { ownerPerforms, why, confirm?, holder? }.
 * Pure — every input is preloaded — so the rules are testable in isolation.
 */
function classify(s, { members, usersById, can }) {
    const sid = String(s._id);
    const created = s.createdAt ? new Date(s.createdAt) : null;
    const creator = s.createdBy ? usersById.get(String(s.createdBy)) : null;
    const holders = members.filter((m) => listsService(m, sid));
    const shape = memberPathShape(s);

    if (!created || created < MEMBER_SELF_ADD_SINCE) {
        return { ownerPerforms: true, why: `created ${created ? ymd(created) : 'long ago'}, before team members could add services of their own` };
    }

    // Who could have made it as an ordinary MENU item instead? The owner always
    // could, and so could any team member who can edit the menu (services:edit).
    // The menu form with an empty description writes the very same shape as a
    // member's add (no category, description = name), so for those creators the
    // shape proves nothing — the row may be the owner's own menu item that was
    // later also given to a member. Only a creator who could NOT use the menu (a
    // plain Service provider) leaves a row that can only be a member's add.
    const byStaff = !!creator && creator.role === 'staff' && String(creator.staffOf) === String(s.provider);
    const couldUseMenu = !byStaff || can(creator, 'services:edit');
    const creatorName = byStaff ? (members.find((m) => String(m.user) === String(creator._id))?.name || creator.name) : null;

    // A. A team member added it for themselves (My services → + Add Service).
    let staffGap = null;
    if (byStaff) {
        const own = members.find((m) => String(m.user) === String(creator._id));
        const who = creatorName;
        const stillTheirs = !!own && listsService(own, sid);
        if (stillTheirs && shape && !couldUseMenu) {
            return { ownerPerforms: false, holder: own, why: `${who} added it as their own service on ${ymd(created)}` };
        }
        if (own && !stillTheirs && !holders.length) {
            staffGap = `added by ${who} on ${ymd(created)}, but ${firstName(who)} no longer offers it`;
        } else if (stillTheirs) {
            staffGap = `added by ${who} on ${ymd(created)}, but ${!shape ? 'it has since been edited like a menu item'
                : `${firstName(who)} can also edit the business menu, so it may be a menu item`}`;
        } else if (!own) {
            staffGap = `added by ${who} on ${ymd(created)}, but ${who} is no longer on the team`;
        }
    }

    // B. Added for one member from the Team screen ("Add a service <member>
    // offers"). Only a creator who couldn't have put it on the menu makes it
    // theirs; the owner (or a menu-editing manager) may have made it a menu item
    // first, so it stays with the owner and is listed to confirm.
    const single = holders.length === 1 && holders[0].offersAllServices === false ? holders[0] : null;
    if (created >= OWNER_ADD_FOR_MEMBER_SINCE && single && shape && !staffGap) {
        if (!couldUseMenu && typedHere(single, s)) {
            return { ownerPerforms: false, holder: single, why: `added for ${single.name} from the Team screen by ${creatorName} on ${ymd(created)} — the price on it is ${firstName(single.name)}'s` };
        }
        const by = byStaff ? creatorName : 'you';
        return {
            ownerPerforms: true, confirm: true,
            why: typedHere(single, s)
                ? `only ${single.name} offers it, at the price on it — but ${by} could also have made it as a menu item, so it may be yours too`
                : `only ${single.name} offers it, but ${firstName(single.name)}'s price for it differs, so it can't be told apart from a menu item`,
        };
    }

    if (staffGap) return { ownerPerforms: true, confirm: true, why: staffGap };
    return { ownerPerforms: true, why: `a menu item (created ${ymd(created)})` };
}

async function migrateOwnerPerforms({ dryRun = false } = {}) {
    const Service = require('../src/models/Service');
    const TeamMember = require('../src/models/TeamMember');
    const User = require('../src/models/User');
    const Appointment = require('../src/models/Appointment');
    // Whether a member could use the menu editor WHEN they created the row.
    // Access levels are gone now (every member is the same), but the rows were
    // made under the old ones: a Manager (staffTier 'high', or a services:edit
    // grant) could edit the menu, so their rows prove nothing either way. Read
    // from the stored fields, which are kept for exactly this kind of history.
    const can = (u, cap) => {
        if (cap !== 'services:edit') return false;
        if (!u || u.role !== 'staff') return !!u;
        return u.staffTier === 'high' || (Array.isArray(u.staffPermissions) && u.staffPermissions.includes('services:edit'));
    };
    const mongoose = require('mongoose');

    const undecided = await Service.find({ provider: { $ne: null }, ownerPerforms: UNDECIDED })
        .select('name description provider createdBy createdAt category options addOns price duration isActive')
        .sort({ provider: 1, createdAt: 1 })
        .lean();
    if (!undecided.length) return { teamOnly: [], kept: [], confirm: [], ownerBookings: [], dryRun };

    const providerIds = [...new Set(undecided.map((s) => String(s.provider)))];
    const creatorIds = [...new Set(undecided.map((s) => s.createdBy).filter((v) => v != null).map(String))]
        .filter((id) => mongoose.isValidObjectId(id));
    const [members, creators, owners] = await Promise.all([
        TeamMember.find({ provider: { $in: providerIds } })
            .select('provider user name services offersAllServices serviceOverrides isActive bookable').lean(),
        // Some old rows have no createdBy (or a malformed one); String() would turn
        // that into 'undefined' and the query would throw a CastError, failing the
        // deploy. Drop missing values first, then anything that isn't an ObjectId.
        User.find({ _id: { $in: creatorIds } })
            .select('role staffOf name staffTier staffPermissions').lean(),
        User.find({ _id: { $in: providerIds } }).select('name businessProfile.businessName').lean(),
    ]);
    const membersBy = new Map();
    members.forEach((m) => { const k = String(m.provider); if (!membersBy.has(k)) membersBy.set(k, []); membersBy.get(k).push(m); });
    const usersById = new Map(creators.map((u) => [String(u._id), u]));
    const businessOf = new Map(owners.map((o) => [String(o._id), o.businessProfile?.businessName || o.name || String(o._id)]));

    const decisions = undecided.map((s) => {
        const d = classify(s, { members: membersBy.get(String(s.provider)) || [], usersById, can });
        return {
            ...d,
            _id: s._id,
            name: s.name,
            price: s.price,
            provider: String(s.provider),
            business: businessOf.get(String(s.provider)) || String(s.provider),
            holderName: d.holder?.name || null,
            // A team-only service whose person can't currently be booked has
            // nobody to do it: it drops off the client's list until someone offers it.
            unstaffed: d.ownerPerforms === false && !(d.holder && d.holder.isActive !== false && d.holder.bookable !== false),
        };
    });
    const teamOnly = decisions.filter((d) => !d.ownerPerforms);
    const kept = decisions.filter((d) => d.ownerPerforms);

    // Clients who already booked the OWNER for what is now team-only — through
    // the very leak this fixes. Reported, never changed.
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const ownerBookings = teamOnly.length ? await Appointment.find({
        // Single-service bookings carry the service at the top; a multi-service
        // booking lists it in its segments.
        $or: [
            { service: { $in: teamOnly.map((d) => d._id) } },
            { 'services.service': { $in: teamOnly.map((d) => d._id) } },
        ],
        teamMember: null,
        status: { $nin: ['cancelled', 'completed', 'no-show'] },
        appointmentDate: { $gte: startOfToday },
    }).select('service services.service provider appointmentDate startTime').sort({ appointmentDate: 1 }).lean() : [];

    if (!dryRun) {
        // Guarded on "still undecided", so an owner who flipped the switch between
        // the read and the write keeps their choice.
        if (teamOnly.length) {
            await Service.updateMany({ _id: { $in: teamOnly.map((d) => d._id) }, ownerPerforms: UNDECIDED }, { $set: { ownerPerforms: false } });
        }
        if (kept.length) {
            await Service.updateMany({ _id: { $in: kept.map((d) => d._id) }, ownerPerforms: UNDECIDED }, { $set: { ownerPerforms: true } });
        }
    }

    return { teamOnly, kept, confirm: kept.filter((d) => d.confirm), ownerBookings, decisions, dryRun };
}

/** The deploy-log report: every decision, grouped by business. */
function report(result, log = console.log) {
    const { decisions = [], teamOnly, kept, confirm, ownerBookings, dryRun } = result;
    const verb = dryRun ? 'Would decide' : 'Decided';
    log(`${verb} who performs ${decisions.length} service(s): ${teamOnly.length} team-only (no longer shown or bookable under the owner), ${kept.length} kept as the owner's (${confirm.length} to confirm).`);
    const byBusiness = new Map();
    decisions.forEach((d) => { if (!byBusiness.has(d.business)) byBusiness.set(d.business, []); byBusiness.get(d.business).push(d); });
    byBusiness.forEach((list, business) => {
        log(`  ${business}:`);
        list.forEach((d) => {
            const tag = !d.ownerPerforms ? `TEAM ONLY (${d.holderName})` : d.confirm ? 'OWNER KEEPS — please confirm' : 'owner keeps';
            log(`    - ${d.name} [${d._id}]: ${tag} — ${d.why}${d.unstaffed ? '; nobody can be booked for it right now' : ''}`);
        });
    });
    if (ownerBookings.length) {
        const nameOf = new Map(teamOnly.map((d) => [String(d._id), d]));
        log(`  Upcoming bookings clients made with the OWNER for a now team-only service (hand them to the team member, or switch "I offer this" back on):`);
        ownerBookings.forEach((a) => {
            const ids = [a.service, ...(a.services || []).map((x) => x.service)].filter(Boolean).map(String);
            const d = ids.map((id) => nameOf.get(id)).find(Boolean);
            log(`    - ${d?.business}: ${d?.name} on ${ymd(a.appointmentDate)} ${a.startTime} [appointment ${a._id}]`);
        });
    }
    if (teamOnly.length && !dryRun) {
        log(`  Rollback (restores the old reading exactly): db.services.updateMany({_id:{$in:[${teamOnly.map((d) => `ObjectId("${d._id}")`).join(',')}]}},{$unset:{ownerPerforms:1}})`);
    }
}

module.exports = { migrateOwnerPerforms, report, classify, MEMBER_SELF_ADD_SINCE, OWNER_ADD_FOR_MEMBER_SINCE };

// CLI entry point (skipped when required by tests)
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
        await mongoose.connect(uri);
        console.log('Connected.');
        const result = await migrateOwnerPerforms({ dryRun: process.argv.includes('--dry-run') });
        if (!result.decisions) console.log('Every service already says whether its owner performs it — nothing to do.');
        else report(result);
        await mongoose.disconnect();
        process.exit(0);
    })().catch((err) => { console.error(err); process.exit(1); });
}

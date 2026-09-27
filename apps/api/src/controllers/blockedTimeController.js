const { randomUUID } = require('crypto');
const BlockedTime = require('../models/BlockedTime');
const TeamMember = require('../models/TeamMember');
const { can } = require('../utils/permissions');

// The business a request acts on: the owner's own id, or a staff member's
// employer (staffOf). Every provider-scoped query below uses this, so a
// staff member manages only their own business's calendar. null = detached staff.
const businessScope = (req) => (req.user.role === 'staff' ? req.user.staffOf || null : req.user._id);

// The caller's own roster row id in `providerId`'s business, or null.
const myMemberId = async (req, providerId) => {
    const member = await TeamMember.findOne({ user: req.user._id, provider: providerId }).select('_id').lean();
    return member ? member._id : null;
};

// A staff member who may block time ONLY in their own lane: they reached a write
// route through calendar:block:self (Service provider), not calendar:manage.
const ownLaneOnly = (req) => req.user.role === 'staff' && !can(req.user, 'calendar:manage');

const OWN_LANE_MESSAGE = 'You can only block time in your own calendar.';

// Is this (loaded) block in the member's own lane? The owner's (teamMember
// null — owner-only or a legacy "business-wide" row) and colleagues' are not.
const isOwnLaneBlock = (blocked, memberId) =>
    !!(memberId && blocked.teamMember && String(blocked.teamMember) === String(memberId) && !blocked.ownerOnly);

// A recurring series' siblings: same business, same lane, same group. Pinning
// provider + lane keeps a series edit/delete from ever reaching past the block
// the caller was authorized for.
const seriesFilter = (blocked, providerId) => ({
    provider: providerId,
    teamMember: blocked.teamMember || null,
    recurrenceGroupId: blocked.recurrenceGroupId,
});

const MAX_OCCURRENCES = 365;

function generateOccurrences(startDate, recurrenceType, recurrenceEndDate) {
    const dates = [];
    const start = new Date(startDate + 'T00:00:00');
    const end = recurrenceEndDate
        ? new Date(recurrenceEndDate + 'T00:00:00')
        : new Date(start.getTime() + MAX_OCCURRENCES * 24 * 60 * 60 * 1000);

    let current = new Date(start);
    let monthlyStep = 0; // months since start, for the monthly branch
    while (current <= end && dates.length < MAX_OCCURRENCES) {
        dates.push(current.toISOString().split('T')[0]);
        if (recurrenceType === 'daily') {
            current.setDate(current.getDate() + 1);
        } else if (recurrenceType === 'weekly') {
            current.setDate(current.getDate() + 7);
        } else if (recurrenceType === 'monthly') {
            // Advance whole months WITHOUT setMonth's short-month overflow: Jan 31
            // + 1mo becomes Feb 31 → Mar 3, which skips February AND drifts every
            // later occurrence off the intended day. Re-anchor on the start's
            // day-of-month each step, clamped to the target month's length
            // (so the 31st becomes the 28th/30th in short months, then 31st again).
            monthlyStep += 1;
            const m = start.getMonth() + monthlyStep;
            const year = start.getFullYear() + Math.floor(m / 12);
            const month = ((m % 12) + 12) % 12;
            const day = Math.min(start.getDate(), new Date(year, month + 1, 0).getDate());
            current = new Date(year, month, day);
        } else {
            break;
        }
    }
    return dates;
}

exports.getMyBlockedTimes = async (req, res) => {
    try {
        const providerId = businessScope(req);
        if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const query = { provider: providerId };
        // ?teamMember=<id> → only that member's blocks; ?teamMember=business (or
        // owner) → only the owner's blocks (teamMember null); absent → everything.
        if (req.query.teamMember === 'business' || req.query.teamMember === 'owner') query.teamMember = null;
        else if (req.query.teamMember) query.teamMember = req.query.teamMember;
        // A team member who sees only their own calendar gets only the blocks that
        // apply to them: their own. The owner's blocks (every teamMember:null
        // block, legacy "business-wide" rows included) never apply to a member,
        // and a colleague's are not theirs to see.
        if (req.user.role === 'staff' && !can(req.user, 'calendar:view_all')) {
            const memberId = await myMemberId(req, providerId);
            if (!memberId) return res.status(200).json({ success: true, data: [] });
            query.teamMember = memberId;
        }
        const blocked = await BlockedTime.find(query)
            .sort({ date: 1, startTime: 1 });
        res.status(200).json({ success: true, data: blocked });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.createBlockedTime = async (req, res) => {
    try {
        const providerId = businessScope(req);
        if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const { date, startTime, endTime, reason, isRecurring, recurrenceType, recurrenceEndDate, teamMember } = req.body;

        if (!date || !startTime || !endTime) {
            return res.status(400).json({ success: false, message: 'date, startTime and endTime are required' });
        }
        if (startTime >= endTime) {
            return res.status(400).json({ success: false, message: 'endTime must be after startTime' });
        }

        // Scope: a specific staff member's lane, else the OWNER's own time. There
        // is no business-wide block any more (the owner's decision: the owner's
        // blocked times never apply to team members), so a block without a member
        // is always stored ownerOnly, whatever the client sent. The member must
        // belong to this provider.
        let teamMemberId = null;
        if (ownLaneOnly(req)) {
            // A Service provider blocks time in THEIR lane only: never the owner's
            // (no teamMember), never a colleague's. Refused rather than silently
            // re-scoped, so a request meaning "block the owner" can't quietly
            // become "close my column".
            const mine = await myMemberId(req, providerId);
            if (!mine) {
                return res.status(403).json({ success: false, code: 'own_lane_only', message: "You're not on this business's team roster." });
            }
            if (!teamMember || String(teamMember) !== String(mine)) {
                return res.status(403).json({ success: false, code: 'own_lane_only', message: OWN_LANE_MESSAGE });
            }
            teamMemberId = mine;
        } else if (teamMember) {
            const member = await TeamMember.findOne({ _id: teamMember, provider: providerId });
            if (!member) {
                return res.status(400).json({ success: false, message: 'Unknown team member' });
            }
            teamMemberId = member._id;
        }
        const ownerScoped = !teamMemberId;

        if (isRecurring && recurrenceType) {
            const groupId = randomUUID();
            const occurrences = generateOccurrences(date, recurrenceType, recurrenceEndDate);
            const docs = occurrences.map(d => ({
                provider: providerId,
                teamMember: teamMemberId,
                ownerOnly: ownerScoped,
                date: d,
                startTime,
                endTime,
                reason: reason || '',
                isRecurring: true,
                recurrenceType,
                recurrenceGroupId: groupId,
                recurrenceEndDate: recurrenceEndDate || null,
            }));
            const created = await BlockedTime.insertMany(docs);
            return res.status(201).json({ success: true, data: created });
        }

        const blocked = await BlockedTime.create({
            provider: providerId,
            teamMember: teamMemberId,
            ownerOnly: ownerScoped,
            date,
            startTime,
            endTime,
            reason: reason || '',
            isRecurring: false,
        });
        res.status(201).json({ success: true, data: blocked });
    } catch (error) {
        console.error('createBlockedTime error:', error?.message, error?.errors);
        // Don't echo raw error internals to the client (finding #32); the detail is
        // already logged above, and every other controller returns the fixed string.
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updateBlockedTime = async (req, res) => {
    try {
        const providerId = businessScope(req);
        if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const { startTime, endTime, reason, updateMode } = req.body;

        const blocked = await BlockedTime.findOne({ _id: req.params.id, provider: providerId });
        if (!blocked) {
            return res.status(404).json({ success: false, message: 'Blocked time not found' });
        }
        if (ownLaneOnly(req) && !isOwnLaneBlock(blocked, await myMemberId(req, providerId))) {
            return res.status(403).json({ success: false, code: 'own_lane_only', message: 'You can only change time blocked in your own calendar.' });
        }

        const update = {};
        if (startTime !== undefined) update.startTime = startTime;
        if (endTime !== undefined) update.endTime = endTime;
        if (reason !== undefined) update.reason = reason;

        if (update.startTime && update.endTime && update.startTime >= update.endTime) {
            return res.status(400).json({ success: false, message: 'endTime must be after startTime' });
        }

        const mode = updateMode || 'this';

        if (!blocked.isRecurring || mode === 'this') {
            await BlockedTime.findByIdAndUpdate(blocked._id, update);
        } else if (mode === 'thisAndFuture') {
            await BlockedTime.updateMany(
                { ...seriesFilter(blocked, providerId), date: { $gte: blocked.date } },
                update
            );
        } else if (mode === 'all') {
            await BlockedTime.updateMany(seriesFilter(blocked, providerId), update);
        }

        res.status(200).json({ success: true, message: 'Blocked time updated' });
    } catch (error) {
        console.error('updateBlockedTime error:', error?.message);
        // Don't echo raw error internals to the client (finding #32); the detail is
        // already logged above, and every other controller returns the fixed string.
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.deleteBlockedTime = async (req, res) => {
    try {
        const providerId = businessScope(req);
        if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const { deleteMode } = req.body;

        const blocked = await BlockedTime.findOne({ _id: req.params.id, provider: providerId });
        if (!blocked) {
            return res.status(404).json({ success: false, message: 'Blocked time not found' });
        }
        if (ownLaneOnly(req) && !isOwnLaneBlock(blocked, await myMemberId(req, providerId))) {
            return res.status(403).json({ success: false, code: 'own_lane_only', message: 'You can only remove time blocked in your own calendar.' });
        }

        const mode = deleteMode || 'this';

        if (!blocked.isRecurring || mode === 'this') {
            await BlockedTime.findByIdAndDelete(blocked._id);
        } else if (mode === 'thisAndFuture') {
            await BlockedTime.deleteMany({
                ...seriesFilter(blocked, providerId),
                date: { $gte: blocked.date },
            });
        } else if (mode === 'all') {
            await BlockedTime.deleteMany(seriesFilter(blocked, providerId));
        }

        res.status(200).json({ success: true, message: 'Blocked time deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Exported for unit testing the recurrence expansion (esp. month-end clamping).
exports._generateOccurrences = generateOccurrences;

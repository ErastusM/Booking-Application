// Pure helpers for the booking time-slot list.
//
// Rule: full 1-hour blocks are the anchor, for EVERY booking surface — the
// provider's manual walk-in / book-a-client flow and reschedule (matches the
// customer app). A completely free hour offers only its :00 (a free 5:00–6:00
// shows 5:00, not 5:30), whatever the service length. Partial-hour starts come
// only from real boundaries, never an arbitrary mid-hour offset:
//   - every working period's OPENING time (the block's start — 08:30, or 14:30
//     after a split day's break — and any `openings` passed in) is ALWAYS
//     offered when the service fits before that period closes (the owner's
//     answer: "your exact opening time is always offered");
//   - a booking's END is offered when the service either stays inside the
//     leftover up to the next hour, or ends exactly on an hour — so leftover
//     minutes get used without a whole-hour booking sliding off the hour:
//       booking 9:00–9:15, 15-min service → 9:15 (fills the 9:15–10:00 leftover)
//       booking 4:00–4:30: 30-min → 4:30 (ends 5:00); 60-min → none (would end 5:30);
//                          1h30 → 4:30 (4:30–6:00)
// Starts must fit inside the working block, not be in the past, and not overlap a
// booking. A genuinely-bookable hour that is fully taken keeps a single greyed pill
// so the waitlist still works (at the hour, or at the opening time when the
// period opens mid-hour).
//
// All times are in minutes-from-midnight.

export const overlapsRange = (ranges, start, end) =>
    ranges.some((b) => start < b.end && end > b.start);

export const fmtMinutes = (mins) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/**
 * @param {Object}   args
 * @param {{start:number,end:number}[]} args.blocks       working blocks for the day
 * @param {{start:number,end:number}[]} args.bookedRanges  already-booked ranges
 * @param {number}   args.duration  service length in minutes
 * @param {number}   [args.minStart] earliest allowed start (e.g. "now" for today); -1 = none
 * @param {number[]} [args.openings] extra period opening times (minutes) that are
 *        always offered when usable — e.g. the day's own hours while the owner
 *        books outside them over a wider block
 * @returns {{time:string, isBooked:boolean}[]}
 */
export const buildTimeSlots = ({ blocks, bookedRanges = [], duration, minStart = -1, openings = [] }) => {
    const slots = [];
    const dur = duration || 60;

    blocks.forEach((block) => {
        // A start is usable when it's inside the block, the whole service fits,
        // and it isn't in the past.
        const usable = (start) =>
            start >= block.start && start + dur <= block.end && start >= minStart;

        // Partial-hour starts come from real boundaries only. A period's opening
        // time is always a candidate; a booked-range END is kept when the service
        // either fits inside the leftover up to the next hour (a 15-min service in
        // a 9:15–10:00 gap), or ends exactly on an hour (a 1h30 that runs
        // 4:30–6:00). A whole-hour service that would end mid-hour (4:30 → 5:30)
        // is dropped there, so it stays on the hour.
        const partialStarts = new Set();
        const openingStarts = new Set();
        const addOpening = (t) => {
            if (t % 60 === 0 || t < block.start || t >= block.end) return;
            partialStarts.add(t);
            openingStarts.add(t);
        };
        addOpening(block.start);
        (openings || []).forEach(addOpening);
        const consider = (t) => {
            if (t % 60 === 0) return;
            const gapEnd = (Math.floor(t / 60) + 1) * 60; // next hour boundary after t
            if (t + dur <= gapEnd || (t + dur) % 60 === 0) partialStarts.add(t);
        };
        bookedRanges.forEach((b) => consider(b.end));

        const firstHour = Math.floor(block.start / 60) * 60;
        for (let hourStart = firstHour; hourStart < block.end; hourStart += 60) {
            let anyFree = false;
            let occupied = false;
            let takenOpening = null;
            // Candidate starts in this hour: the :00, plus any aligned leftover
            // starts that fall inside it — sorted so the list stays chronological.
            const candidates = [hourStart, ...[...partialStarts].filter((t) => t >= hourStart && t < hourStart + 60)]
                .sort((a, b) => a - b);
            for (const start of candidates) {
                if (!usable(start)) continue;
                if (overlapsRange(bookedRanges, start, start + dur)) {
                    occupied = true;
                    if (takenOpening === null && openingStarts.has(start)) takenOpening = start;
                    continue;
                }
                slots.push({ time: fmtMinutes(start), isBooked: false });
                anyFree = true;
            }
            // Fully-taken but genuinely-bookable hour → one greyed pill so the
            // waitlist still works: at the hour, or — when the hour itself is
            // before the period opens (08:00 for an 08:30 opening) — at the
            // taken opening time. Never a pill for a past/unusable hour.
            if (!anyFree && occupied) {
                if (usable(hourStart)) slots.push({ time: fmtMinutes(hourStart), isBooked: true });
                else if (takenOpening !== null) slots.push({ time: fmtMinutes(takenOpening), isBooked: true });
            }
        }
    });

    return slots;
};

// ── Which hours a time list is built from ───────────────────────────────────
// Every screen that turns "working hours" into times goes through these, so the
// Working Hours screen, New Appointment and the client booking page read the
// same day the same way (Sunday = 0, the date's own weekday in the browser).

export const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

// ── Whose time a booking takes ──────────────────────────────────────────────
// The New Appointment times must be exactly the ones the server accepts, so the
// busy windows for a lane are read the way the API reads them
// (staffBooking.memberBusyIntervalsBuffered):
//   - a multi-service ticket takes ONLY the segments that lane performs, each at
//     its own window — not the whole ticket, and not only for the ticket's
//     top-level performer. (Matching on the top-level performer showed a member
//     who does segment 2 of a colleague's ticket as free — every time was
//     offered and then refused — and greyed the colleague for the whole ticket.)
//   - a single booking (group rows included) takes its whole window for its one
//     performer;
//   - each window is widened by its service's setup/clean-up buffers, and by the
//     new booking's own (the server widens both sides).
// `lane` is a member id, or '' for the owner's own column; `laneOf(id)` maps a
// booking's performer id onto a lane the same way the calendar's lanes do.

const idOf = (x) => (x && typeof x === 'object' ? String(x._id || '') : String(x || ''));

/**
 * @param {object[]} appointments  the day's non-cancelled bookings
 * @param {string}   lane          member id, or '' = the owner
 * @param {(id:string)=>string} laneOf
 * @param {{ bufferOf?: (serviceId:string)=>{bufferBefore?:number,bufferAfter?:number}|undefined,
 *           incoming?: {bufferBefore?:number,bufferAfter?:number} }} [opts]
 * @returns {{start:number,end:number}[]} minutes-from-midnight
 */
export const laneBusyRanges = (appointments, lane, laneOf, { bufferOf = () => null, incoming = null } = {}) => {
    const out = [];
    const push = (startTime, endTime, serviceId) => {
        const b = bufferOf(idOf(serviceId)) || {};
        out.push({
            start: toMin(startTime) - (b.bufferBefore || 0) - (incoming?.bufferAfter || 0),
            end: toMin(endTime) + (b.bufferAfter || 0) + (incoming?.bufferBefore || 0),
        });
    };
    (appointments || []).forEach((a) => {
        if (Array.isArray(a.services) && a.services.length) {
            a.services.forEach((seg) => {
                if (laneOf(idOf(seg.teamMember)) === lane) push(seg.startTime, seg.endTime, seg.service);
            });
            // A ticket stretched on the calendar runs past its segments; that
            // stretch is its top-level performer's time (the server's
            // ticketRemainder), so it is theirs here too.
            if (laneOf(idOf(a.teamMember)) === lane) {
                const segs = a.services.map((seg) => [toMin(seg.startTime), toMin(seg.endTime)])
                    .filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
                let cursor = toMin(a.startTime);
                const end = toMin(a.endTime);
                segs.forEach(([x, y]) => {
                    if (x > cursor) push(fmt(cursor), fmt(Math.min(x, end)), a.service);
                    cursor = Math.max(cursor, y);
                });
                if (cursor < end) push(fmt(cursor), fmt(end), a.service);
            }
        } else if (laneOf(idOf(a.teamMember)) === lane) {
            push(a.startTime, a.endTime, a.service);
        }
    });
    return out;
};

const fmt = (m) => `${Math.floor(m / 60)}:${m % 60}`;

/**
 * The setup/clean-up buffers of a NEW multi-service booking, as one envelope:
 * back-to-back services widened by their own buffers cover exactly
 * [start - bufferBefore, end + bufferAfter] of the whole ticket (the server
 * widens each segment by its service's buffers). `rows` are the ticket's
 * services in order, each with the `duration` it will be booked at.
 * @returns {{bufferBefore:number, bufferAfter:number}}
 */
export const ticketBuffers = (rows, bufferOf = () => null) => {
    const total = (rows || []).reduce((sum, r) => sum + (r?.duration || 0), 0);
    let before = 0;
    let after = 0;
    let offset = 0;
    (rows || []).forEach((r) => {
        const b = bufferOf(idOf(r?._id)) || {};
        before = Math.max(before, (b.bufferBefore || 0) - offset);
        offset += r?.duration || 0;
        after = Math.max(after, (b.bufferAfter || 0) - (total - offset));
    });
    return { bufferBefore: before, bufferAfter: after };
};

/** "HH:mm" periods → sorted minute blocks, dropping anything empty or inverted. */
export const periodsToBlocks = (periods) => (periods || [])
    .filter((s) => s?.start && s?.end)
    .map((s) => ({ start: toMin(s.start), end: toMin(s.end) }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start)
    .sort((a, b) => a.start - b.start);

/** The weekday name of a 'YYYY-MM-DD' date (calendar date, no timezone shift). */
export const dayNameOf = (ymd) => {
    const [y, m, d] = String(ymd).split('-').map(Number);
    return DAY_NAMES[new Date(y, m - 1, d).getDay()];
};

/**
 * A weekly schedule's blocks for one date. null = no schedule to go by; [] = closed.
 */
export const scheduleBlocksFor = (schedule, ymd) => {
    if (!schedule || !ymd) return null;
    const cfg = schedule[dayNameOf(ymd)];
    if (!cfg?.enabled) return [];
    return periodsToBlocks(cfg.slots);
};

/** Blocks as "09:00–14:00, 15:00–18:00". */
export const blocksLabel = (blocks) => blocks.map((b) => `${fmtMinutes(b.start)}–${fmtMinutes(b.end)}`).join(', ');

const durLabel = (mins) => {
    const h = Math.floor(mins / 60); const m = mins % 60;
    return h && m ? `${h}h ${m}min` : h ? `${h}h` : `${m} min`;
};

/**
 * The line under "Start time" that says which hours the times come from and why
 * a time the owner might expect isn't there. The list itself follows fixed rules
 * (hourly starts plus each period's exact opening time, the whole service must
 * end by closing, nothing in the past); this makes each of those visible instead
 * of looking like wrong hours. `whose` is the possessive ('Your', 'Erastus’s');
 * empty = the business's own.
 */
const SOURCE_LABEL = { shift: ' (shift)', business: ' (the business’s hours)', weekly: '' };
export const hoursNote = ({ blocks, duration, minStart = -1, whose = '', day = '', source = '' }) => {
    const who = whose ? `${whose} hours` : 'Working hours';
    const dayLabel = day ? ` on ${day.charAt(0).toUpperCase()}${day.slice(1)}` : '';
    const parts = [`${who}${dayLabel}: ${blocksLabel(blocks)}${whose ? SOURCE_LABEL[source] || '' : ''}.`];
    const dur = duration || 60;
    const offHour = blocks.some((b) => b.start % 60 !== 0);
    parts.push(`Times start ${offHour ? 'at each opening time and ' : ''}on the hour, and the last start leaves room for the ${durLabel(dur)} service.`);
    if (minStart >= 0 && blocks.some((b) => b.start < minStart)) parts.push('Earlier times today have passed.');
    return parts.join(' ');
};

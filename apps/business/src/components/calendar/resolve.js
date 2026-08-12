/**
 * Working out who else has to move when a booking is dropped on top of someone.
 *
 * Overlapping isn't an error, it's a decision: the provider dragged a booking
 * into an occupied slot on purpose, and the calendar's job is to offer the ways
 * out rather than to spring the card back. These are the ways out.
 *
 * Everything here is pure — no React, no DOM, no dates beyond minute integers —
 * so the awkward cases (a push that ripples through a whole afternoon, a swap
 * into a slot that's too short) are unit-testable without a browser.
 *
 * Shape of an "item": { id, dateKey, startMin, endMin, staffKey, locked }
 *   staffKey  groups bookings that can collide — the assigned team member, or
 *             '' for the owner's own column. Different staff never collide.
 *   locked    finished work. It can't be picked up and it can't be shoved
 *             aside either, so any route that would move it is withdrawn.
 */

export const SNAP_MIN = 15;
export const DAY_MIN = 24 * 60;

/** Every item a candidate placement would run into, earliest first. */
export const clashesAt = (items, movingId, place, staffKey, skipIds = []) =>
    items
        .filter((o) => o.id !== movingId
            && skipIds.indexOf(o.id) === -1
            && o.dateKey === place.dateKey
            && o.staffKey === staffKey
            && place.startMin < o.endMin && place.endMin > o.startMin)
        .sort((a, b) => a.startMin - b.startMin);

/**
 * Push the occupant later, and let the shove ripple through the rest of that
 * staff member's day.
 *
 * Returns null rather than a partial plan when the ripple would shunt finished
 * work or run off the end of the day — a route that can't complete must not be
 * offered, because silently truncating it would drop somebody's booking.
 */
export const planPush = (items, movingId, place, staffKey) => {
    const rest = items
        .filter((o) => o.id !== movingId && o.dateKey === place.dateKey && o.staffKey === staffKey)
        .sort((a, b) => a.startMin - b.startMin);

    const moves = [];
    let cursor = place.endMin;

    for (const o of rest) {
        if (o.endMin <= place.startMin) continue;              // finishes first — untouched
        if (o.startMin >= cursor) { cursor = Math.max(cursor, o.endMin); continue; }
        if (o.locked) return null;
        const dur = o.endMin - o.startMin;
        if (cursor + dur > DAY_MIN) return null;
        moves.push({ id: o.id, dateKey: place.dateKey, startMin: cursor, endMin: cursor + dur });
        cursor += dur;
    }
    return moves.length ? moves : null;
};

/** Trade places: the occupant takes the slot the dragged booking just left. */
export const planSwap = (items, movingId, place, staffKey, origin, hit) => {
    if (!hit || hit.locked) return null;
    // A resize vacates nothing, so there is no slot to swap into.
    if (origin.dateKey === place.dateKey && origin.startMin === place.startMin) return null;

    const dur = hit.endMin - hit.startMin;
    const target = { dateKey: origin.dateKey, startMin: origin.startMin, endMin: origin.startMin + dur };
    if (target.endMin > DAY_MIN) return null;
    if (clashesAt(items, hit.id, target, staffKey, [movingId]).length) return null;
    // `items` still holds the mover at its OLD slot, so clashesAt cannot see the
    // slot it is moving TO. Without this the swap lands the occupant on top of
    // the mover whenever the drag is shorter than the occupant's duration:
    // A 09:00-09:30 dragged 15 min with B 09:30-10:30 puts A entirely inside B.
    if (target.startMin < place.endMin && target.endMin > place.startMin) return null;

    return [{ id: hit.id, ...target }];
};

/** Slide the occupant to the first gap that fits, after the new block. */
export const planNextFree = (items, movingId, place, staffKey, hit) => {
    if (!hit || hit.locked) return null;
    const dur = hit.endMin - hit.startMin;
    for (let s = place.endMin; s + dur <= DAY_MIN; s += SNAP_MIN) {
        const target = { dateKey: place.dateKey, startMin: s, endMin: s + dur };
        if (!clashesAt(items, hit.id, target, staffKey, [movingId]).length) {
            return s === hit.startMin ? null : [{ id: hit.id, ...target }];
        }
    }
    return null;
};

/**
 * Every route out of a collision, ready to render.
 *
 * Only `push` understands a queue. Relocating "the occupant" is meaningless
 * when several bookings are in the way — moving one would quietly leave the
 * others still overlapping, resolving a clash by creating one — so the other
 * routes stand down and say why. A route that can't work is still returned,
 * disabled and with a reason, so a missing option is never unexplained.
 */
export const resolutionRoutes = ({ items, movingId, place, staffKey, origin, mode, hits, fmt = String }) => {
    const single = hits.length === 1;
    const many = 'More than one booking is in the way — push them instead';
    const nameOf = (id) => (items.find((i) => i.id === id) || {}).label || 'that booking';

    const push = planPush(items, movingId, place, staffKey);
    const swap = single ? planSwap(items, movingId, place, staffKey, origin, hits[0]) : null;
    let next = single ? planNextFree(items, movingId, place, staffKey, hits[0]) : null;

    // On a quiet day "the next gap" and "push them later" are the same minute.
    // Offering an identical outcome twice only makes the choice look harder.
    if (next && push && push.length === 1 && push[0].id === next[0].id && push[0].startMin === next[0].startMin) {
        next = null;
    }

    return [
        {
            key: 'push', tag: 'Recommended', primary: true, plan: push,
            label: push && push.length > 1 ? 'Push everyone later' : `Push ${hits[0].label} later`,
            reason: push ? null : 'No room left in the day, or finished work is in the way',
            detail: push ? push.map((m) => `${nameOf(m.id)} → ${fmt(m.startMin)}`) : null,
        },
        {
            key: 'swap', tag: 'Swap', plan: swap,
            label: swap ? `Swap with ${hits[0].label}` : 'Swap places',
            reason: swap ? null
                : !single ? many
                : mode === 'resize' ? 'Nothing was vacated to swap into'
                : 'The old slot is too short or already taken',
            detail: swap ? [`${nameOf(swap[0].id)} takes the ${fmt(origin.startMin)} slot you just left`] : null,
        },
        {
            key: 'next', tag: 'Next gap', plan: next,
            label: next ? `Move ${hits[0].label} to the next opening` : 'Move to the next opening',
            reason: next ? null
                : !single ? many
                : 'Same result as pushing them, or no gap big enough today',
            detail: next ? [`First free slot is ${fmt(next[0].startMin)}`] : null,
        },
        {
            key: 'manual', tag: 'Manual', plan: single ? 'manual' : null,
            label: single ? `Let me place ${hits[0].label} myself` : 'Place them myself',
            reason: single ? null : many,
            detail: single ? [`Commits this move, then hands you ${hits[0].label} to drop where you like`] : null,
        },
    ];
};

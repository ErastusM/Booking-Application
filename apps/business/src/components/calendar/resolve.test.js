import { describe, it, expect } from 'vitest';
import { clashesAt, planPush, planSwap, planNextFree, resolutionRoutes } from './resolve';

/**
 * The displacement planners.
 *
 * These are pure minute arithmetic, and they are the part of drag-to-reschedule
 * most able to be quietly wrong: a plan that looks sensible in the sheet and
 * produces an impossible day. `planSwap` did exactly that in production — it
 * proposed putting two bookings on top of each other — and nothing caught it
 * until an audit read the code, because a build compiles it happily and the API
 * suite never sees it.
 *
 * The invariant every route must satisfy: APPLYING THE PLAN LEAVES NO OVERLAP.
 * That is asserted directly below rather than inferred from the shape of the
 * output, so a future planner cannot pass by returning something plausible.
 */

const item = (id, startMin, endMin, extra = {}) => ({
    id, dateKey: 'd1', startMin, endMin, staffKey: 's1', locked: false, label: id, ...extra,
});
const at = (h, m = 0) => h * 60 + m;

/** Apply a plan (plus the mover) and report every remaining overlap. */
const overlapsAfter = (items, movingId, place, plan) => {
    const moved = new Map((plan || []).map((m) => [m.id, m]));
    const final = items.map((i) => {
        if (i.id === movingId) return { ...i, ...place };
        const m = moved.get(i.id);
        return m ? { ...i, startMin: m.startMin, endMin: m.endMin, dateKey: m.dateKey } : i;
    });
    const bad = [];
    for (let i = 0; i < final.length; i += 1) {
        for (let j = i + 1; j < final.length; j += 1) {
            const a = final[i], b = final[j];
            if (a.dateKey !== b.dateKey || a.staffKey !== b.staffKey) continue;
            if (a.startMin < b.endMin && a.endMin > b.startMin) bad.push(`${a.id}/${b.id}`);
        }
    }
    return bad;
};

describe('clashesAt', () => {
    it('treats touching bookings as clear', () => {
        const items = [item('B', at(10), at(11))];
        // Ends exactly where B starts.
        expect(clashesAt(items, 'A', { dateKey: 'd1', startMin: at(9), endMin: at(10) }, 's1')).toEqual([]);
        // Overlaps by one minute.
        expect(clashesAt(items, 'A', { dateKey: 'd1', startMin: at(9), endMin: at(10, 1) }, 's1')).toHaveLength(1);
    });

    it('never collides across staff or across days', () => {
        const items = [item('B', at(10), at(11), { staffKey: 's2' }), item('C', at(10), at(11), { dateKey: 'd2' })];
        expect(clashesAt(items, 'A', { dateKey: 'd1', startMin: at(10), endMin: at(11) }, 's1')).toEqual([]);
    });
});

describe('planPush', () => {
    it('ripples through the rest of the day', () => {
        const items = [item('A', at(9), at(10)), item('B', at(10), at(11)), item('C', at(11, 15), at(11, 45))];
        // A is stretched to 09:00-10:30, which shoves B to 10:30-11:30, which
        // then runs into C — the second-order shove is the point of this case.
        const place = { dateKey: 'd1', startMin: at(9), endMin: at(10, 30) };

        const plan = planPush(items, 'A', place, 's1');

        expect(plan).toEqual([
            { id: 'B', dateKey: 'd1', startMin: at(10, 30), endMin: at(11, 30) },
            { id: 'C', dateKey: 'd1', startMin: at(11, 30), endMin: at(12) },
        ]);
        expect(overlapsAfter(items, 'A', place, plan)).toEqual([]);
    });

    // The shove stops as soon as the day has room again, rather than marching
    // every later booking along behind it for no reason.
    it('stops rippling once a booking already starts clear', () => {
        const items = [item('A', at(9), at(10)), item('B', at(10), at(11)), item('C', at(11, 30), at(12))];
        const place = { dateKey: 'd1', startMin: at(9), endMin: at(10, 30) };

        const plan = planPush(items, 'A', place, 's1');

        // B lands at 10:30-11:30, exactly where C starts — so C stays put.
        expect(plan).toEqual([{ id: 'B', dateKey: 'd1', startMin: at(10, 30), endMin: at(11, 30) }]);
        expect(overlapsAfter(items, 'A', place, plan)).toEqual([]);
    });

    it('leaves alone anything that finishes before the block', () => {
        const items = [item('A', at(14), at(15)), item('EARLY', at(8), at(9))];
        const place = { dateKey: 'd1', startMin: at(13), endMin: at(14) };
        expect(planPush(items, 'A', place, 's1')).toBeNull();     // nobody needs to move
    });

    // A partial plan would silently drop somebody's booking.
    it('refuses rather than shoving finished work', () => {
        const items = [item('A', at(9), at(10)), item('DONE', at(10), at(11), { locked: true })];
        const place = { dateKey: 'd1', startMin: at(9), endMin: at(10, 30) };
        expect(planPush(items, 'A', place, 's1')).toBeNull();
    });

    it('refuses rather than pushing past the end of the day', () => {
        const items = [item('A', at(22), at(23)), item('B', at(23), at(23, 59))];
        const place = { dateKey: 'd1', startMin: at(22), endMin: at(23, 30) };
        expect(planPush(items, 'A', place, 's1')).toBeNull();
    });
});

describe('planSwap', () => {
    // The production bug, pinned. `items` holds the mover at its OLD slot, so
    // the clash check could not see where it was moving TO; whenever the drag
    // was shorter than the occupant's duration, the swap put them on top of
    // each other and the sheet cheerfully offered it.
    it('refuses when the swap would land the occupant on the mover', () => {
        const items = [item('A', at(9), at(9, 30)), item('B', at(9, 30), at(10, 30))];
        const origin = { dateKey: 'd1', startMin: at(9), endMin: at(9, 30) };
        const place = { dateKey: 'd1', startMin: at(9, 15), endMin: at(9, 45) };   // dragged 15 min

        const plan = planSwap(items, 'A', place, 's1', origin, items[1]);

        expect(plan).toBeNull();
    });

    it('trades places when the vacated slot genuinely fits', () => {
        const items = [item('A', at(9), at(10)), item('B', at(14), at(15))];
        const origin = { dateKey: 'd1', startMin: at(9), endMin: at(10) };
        const place = { dateKey: 'd1', startMin: at(14), endMin: at(15) };

        const plan = planSwap(items, 'A', place, 's1', origin, items[1]);

        expect(plan).toEqual([{ id: 'B', dateKey: 'd1', startMin: at(9), endMin: at(10) }]);
        expect(overlapsAfter(items, 'A', place, plan)).toEqual([]);
    });

    it('refuses when the vacated slot is too short for the occupant', () => {
        const items = [item('A', at(9), at(9, 30)), item('B', at(14), at(15)), item('X', at(9, 30), at(11))];
        const origin = { dateKey: 'd1', startMin: at(9), endMin: at(9, 30) };
        const place = { dateKey: 'd1', startMin: at(14), endMin: at(14, 30) };

        // B needs 60 minutes at 09:00 but X occupies 09:30-11:00.
        expect(planSwap(items, 'A', place, 's1', origin, items[1])).toBeNull();
    });

    it('has nothing to swap into on a resize', () => {
        const items = [item('A', at(9), at(10)), item('B', at(10), at(11))];
        const origin = { dateKey: 'd1', startMin: at(9), endMin: at(10) };
        const place = { dateKey: 'd1', startMin: at(9), endMin: at(10, 30) };   // same start = resize
        expect(planSwap(items, 'A', place, 's1', origin, items[1])).toBeNull();
    });

    it('will not move finished work', () => {
        const items = [item('A', at(9), at(10)), item('DONE', at(14), at(15), { locked: true })];
        const origin = { dateKey: 'd1', startMin: at(9), endMin: at(10) };
        const place = { dateKey: 'd1', startMin: at(14), endMin: at(15) };
        expect(planSwap(items, 'A', place, 's1', origin, items[1])).toBeNull();
    });
});

describe('planNextFree', () => {
    it('slides the occupant to the first gap that fits', () => {
        const items = [item('A', at(9), at(10)), item('B', at(10), at(11)), item('C', at(11), at(12))];
        const place = { dateKey: 'd1', startMin: at(9), endMin: at(10, 30) };

        const plan = planNextFree(items, 'A', place, 's1', items[1]);

        expect(plan[0].startMin).toBe(at(12));   // 10:30 and 11:00 are taken by C
        expect(overlapsAfter(items, 'A', place, plan)).toEqual([]);
    });

    it('returns null when the occupant is already in the first free slot', () => {
        const items = [item('A', at(9), at(9, 30)), item('B', at(9, 30), at(10))];
        const place = { dateKey: 'd1', startMin: at(9), endMin: at(9, 30) };
        expect(planNextFree(items, 'A', place, 's1', items[1])).toBeNull();
    });
});

describe('resolutionRoutes', () => {
    const routesFor = (items, movingId, place, origin, hits, mode = 'move') =>
        resolutionRoutes({ items, movingId, place, staffKey: 's1', origin, mode, hits, fmt: String });

    it('stands the single-occupant routes down when several are in the way', () => {
        const items = [item('A', at(9), at(10)), item('B', at(10), at(11)), item('C', at(11), at(12))];
        const place = { dateKey: 'd1', startMin: at(10), endMin: at(12) };
        const hits = [items[1], items[2]];

        const routes = routesFor(items, 'A', place, { dateKey: 'd1', startMin: at(9), endMin: at(10) }, hits);
        const by = Object.fromEntries(routes.map((r) => [r.key, r]));

        // Only push understands a queue; the others would leave someone overlapping.
        expect(by.push.plan).toBeTruthy();
        expect(by.swap.plan).toBeNull();
        expect(by.next.plan).toBeNull();
        expect(by.manual.plan).toBeNull();
        [by.swap, by.next, by.manual].forEach((r) => expect(r.reason).toMatch(/more than one/i));
    });

    // A route that cannot work must still be explained, never silently missing.
    it('always returns every route, with a reason when unavailable', () => {
        const items = [item('A', at(9), at(10)), item('DONE', at(10), at(11), { locked: true })];
        const place = { dateKey: 'd1', startMin: at(9, 30), endMin: at(10, 30) };

        const routes = routesFor(items, 'A', place, { dateKey: 'd1', startMin: at(9), endMin: at(10) }, [items[1]]);

        expect(routes.map((r) => r.key)).toEqual(['push', 'swap', 'next', 'manual']);
        routes.forEach((r) => {
            if (!r.plan) expect(r.reason).toBeTruthy();
        });
    });

    it('does not offer the same outcome twice', () => {
        const items = [item('A', at(9), at(10)), item('B', at(10), at(11))];
        const place = { dateKey: 'd1', startMin: at(9), endMin: at(10, 30) };

        const routes = routesFor(items, 'A', place, { dateKey: 'd1', startMin: at(9), endMin: at(10) }, [items[1]]);
        const by = Object.fromEntries(routes.map((r) => [r.key, r]));

        // Push and next-gap both land B at 10:30 here, so next-gap stands down.
        expect(by.push.plan[0].startMin).toBe(at(10, 30));
        expect(by.next.plan).toBeNull();
    });

    // The invariant that matters more than any individual route.
    it('never proposes a plan that leaves an overlap', () => {
        const items = [item('A', at(9), at(9, 30)), item('B', at(9, 30), at(10, 30)), item('C', at(11), at(12))];
        const origin = { dateKey: 'd1', startMin: at(9), endMin: at(9, 30) };

        // Sweep every 15-minute placement across the day and check every route.
        for (let start = 0; start <= 22 * 60; start += 15) {
            const place = { dateKey: 'd1', startMin: start, endMin: start + 30 };
            const hits = clashesAt(items, 'A', place, 's1');
            if (!hits.length) continue;
            resolutionRoutes({ items, movingId: 'A', place, staffKey: 's1', origin, mode: 'move', hits, fmt: String })
                .filter((r) => r.plan && r.plan !== 'manual')
                .forEach((r) => {
                    expect(overlapsAfter(items, 'A', place, r.plan), `${r.key} at ${start}`).toEqual([]);
                });
        }
    });
});

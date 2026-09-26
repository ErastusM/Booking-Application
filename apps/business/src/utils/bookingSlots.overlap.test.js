import { describe, it, expect } from 'vitest';
import { buildTimeSlots, laneBusyRanges, ticketBuffers } from './bookingSlots';

// The New Appointment rule, end to end: a start is offered only if the WHOLE
// service fits in the chosen person's time — inside their hours and clear of
// every booking of theirs (a colleague's segment of a shared ticket included).
// A booking that ends exactly when the next starts is fine.

const H = (h, m = 0) => h * 60 + m;
const free = (slots) => slots.filter((s) => !s.isBooked).map((s) => s.time);
const DAY = { start: H(8), end: H(18) };

const ERASTUS = 'm-erastus';
const HILDA = 'm-hilda';
const roster = new Set([ERASTUS, HILDA]);
// Same mapping as the dashboard: a roster member is their own lane, anything else
// (no member, or one who left) is the owner's ('').
const laneOf = (id) => (id && roster.has(String(id)) ? String(id) : '');

const appt = (teamMember, startTime, endTime, extra = {}) => ({ teamMember, startTime, endTime, service: 'svc-cut', ...extra });

describe("the owner's report: a 2-hour service next to a 15:00 booking", () => {
    const booked = laneBusyRanges([appt(null, '15:00', '16:00')], '', laneOf);

    it('does not offer 14:00 (it would run into 15:00) or 15:00; offers 13:00 and 16:00', () => {
        const slots = free(buildTimeSlots({ blocks: [DAY], bookedRanges: booked, duration: 120 }));
        expect(slots).toContain('13:00'); // 13:00–15:00 touches the booking — allowed
        expect(slots).not.toContain('14:00');
        expect(slots).not.toContain('15:00');
        expect(slots).toContain('16:00'); // 16:00–18:00 starts as the booking ends
    });

    it('every length: a start is offered iff the whole service ends by 15:00 or starts at 16:00', () => {
        for (const duration of [30, 45, 60, 90, 120]) {
            const slots = free(buildTimeSlots({ blocks: [DAY], bookedRanges: booked, duration }));
            for (const t of slots) {
                const s = H(Number(t.slice(0, 2)), Number(t.slice(3)));
                expect(s + duration <= H(15) || s >= H(16)).toBe(true);
            }
            expect(slots).toContain('16:00');
        }
        expect(free(buildTimeSlots({ blocks: [DAY], bookedRanges: booked, duration: 60 }))).toContain('14:00');
        expect(free(buildTimeSlots({ blocks: [DAY], bookedRanges: booked, duration: 90 }))).not.toContain('14:00');
    });

    it('a day that ends at 16:00 offers 13:00 and 14:00 for 2 hours, never 15:00', () => {
        const slots = free(buildTimeSlots({ blocks: [{ start: H(13), end: H(16) }], duration: 120 }));
        expect(slots).toEqual(['13:00', '14:00']);
    });
});

describe('multi-service tickets count per segment performer', () => {
    // Hilda (the ticket's top-level performer) does 14:00–15:00, Erastus 15:00–16:00.
    const ticket = appt(HILDA, '14:00', '16:00', {
        services: [
            { teamMember: { _id: HILDA, name: 'Hilda' }, startTime: '14:00', endTime: '15:00', service: 'svc-a' },
            { teamMember: { _id: ERASTUS, name: 'Erastus' }, startTime: '15:00', endTime: '16:00', service: 'svc-b' },
        ],
    });

    it("Erastus is busy for his segment even though he isn't the top-level performer", () => {
        const busy = laneBusyRanges([ticket], ERASTUS, laneOf);
        expect(busy).toEqual([{ start: H(15), end: H(16) }]);
        const slots = free(buildTimeSlots({ blocks: [DAY], bookedRanges: busy, duration: 120 }));
        expect(slots).not.toContain('14:00');
        expect(slots).not.toContain('15:00');
        expect(slots).toContain('13:00');
        expect(slots).toContain('16:00');
    });

    it('Hilda is busy only for her own segment — 15:00 is free for her', () => {
        const busy = laneBusyRanges([ticket], HILDA, laneOf);
        expect(busy).toEqual([{ start: H(14), end: H(15) }]);
        expect(free(buildTimeSlots({ blocks: [DAY], bookedRanges: busy, duration: 60 }))).toContain('15:00');
    });

    it("the owner is busy for an unassigned segment of a member's ticket, and not for the rest", () => {
        const shared = appt(HILDA, '10:00', '12:00', {
            services: [
                { teamMember: HILDA, startTime: '10:00', endTime: '11:00' },
                { teamMember: null, startTime: '11:00', endTime: '12:00' },
            ],
        });
        expect(laneBusyRanges([shared], '', laneOf)).toEqual([{ start: H(11), end: H(12) }]);
        expect(laneBusyRanges([shared], HILDA, laneOf)).toEqual([{ start: H(10), end: H(11) }]);
        expect(laneBusyRanges([shared], ERASTUS, laneOf)).toEqual([]);
    });
});

describe('single bookings, groups and lanes', () => {
    it("a booking is its performer's only; a colleague's never blocks you", () => {
        const list = [appt(ERASTUS, '15:00', '16:00'), appt(HILDA, '09:00', '10:00')];
        expect(laneBusyRanges(list, ERASTUS, laneOf)).toEqual([{ start: H(15), end: H(16) }]);
        expect(laneBusyRanges(list, '', laneOf)).toEqual([]);
    });

    it('a group booking (one row per client) takes the whole window', () => {
        const rows = [appt(HILDA, '15:00', '16:00', { groupId: 'g1' }), appt(HILDA, '15:00', '16:00', { groupId: 'g1' })];
        const busy = laneBusyRanges(rows, HILDA, laneOf);
        expect(free(buildTimeSlots({ blocks: [DAY], bookedRanges: busy, duration: 120 }))).not.toContain('14:00');
    });

    it("a departed member's booking sits in the owner's lane (as on the calendar)", () => {
        expect(laneBusyRanges([appt('m-gone', '09:00', '10:00')], '', laneOf)).toEqual([{ start: H(9), end: H(10) }]);
    });
});

describe('buffers are reserved on both sides, as on the server', () => {
    const buffers = { 'svc-cut': { bufferBefore: 0, bufferAfter: 15 }, 'svc-colour': { bufferBefore: 10, bufferAfter: 0 } };
    const bufferOf = (id) => buffers[id];

    it("an existing booking's clean-up time blocks the next start", () => {
        const busy = laneBusyRanges([appt(null, '09:00', '10:00')], '', laneOf, { bufferOf });
        expect(busy).toEqual([{ start: H(9), end: H(10, 15) }]);
        const slots = free(buildTimeSlots({ blocks: [DAY], bookedRanges: busy, duration: 45 }));
        expect(slots).not.toContain('10:00');
        expect(slots).toContain('10:15');
    });

    it("the new booking's own set-up time keeps it off a booking's end", () => {
        const busy = laneBusyRanges([appt(null, '09:00', '10:00', { service: 'svc-colour' })], '', laneOf, {
            bufferOf, incoming: buffers['svc-colour'],
        });
        // Existing 09:00–10:00 widened by its own set-up (10) and the new one's set-up (10).
        expect(busy).toEqual([{ start: H(8, 50), end: H(10, 10) }]);
        expect(free(buildTimeSlots({ blocks: [DAY], bookedRanges: busy, duration: 50 }))).not.toContain('10:00');
    });
});

describe('a new multi-service booking reserves its own buffers, as the server does', () => {
    const buffers = { 'svc-colour': { bufferBefore: 10, bufferAfter: 30 }, 'svc-cut': { bufferBefore: 0, bufferAfter: 15 } };
    const bufferOf = (id) => buffers[id];

    it('the envelope is the first set-up and the last clean-up (a long inner clean-up that spills past the end counts)', () => {
        expect(ticketBuffers([{ _id: 'svc-colour', duration: 60 }, { _id: 'svc-cut', duration: 60 }], bufferOf))
            .toEqual({ bufferBefore: 10, bufferAfter: 15 });
        // Colour's 30-min clean-up after a 15-min last service runs 15 past the end.
        expect(ticketBuffers([{ _id: 'svc-colour', duration: 60 }, { _id: 'svc-x', duration: 15 }], bufferOf))
            .toEqual({ bufferBefore: 10, bufferAfter: 15 });
        expect(ticketBuffers([{ _id: 'svc-x', duration: 30 }], bufferOf)).toEqual({ bufferBefore: 0, bufferAfter: 0 });
    });

    it('Colour + Cut (2 h) before a 15:00 booking: 13:00 ends 15:00 but its clean-up runs to 15:15 — not offered', () => {
        const incoming = ticketBuffers([{ _id: 'svc-colour', duration: 60 }, { _id: 'svc-cut', duration: 60 }], bufferOf);
        const busy = laneBusyRanges([appt(null, '15:00', '16:00', { service: 'svc-x' })], '', laneOf, { bufferOf, incoming });
        const slots = free(buildTimeSlots({ blocks: [DAY], bookedRanges: busy, duration: 120 }));
        expect(slots).not.toContain('13:00');
        expect(slots).toContain('12:00');
    });
});

describe('a ticket stretched on the calendar', () => {
    // Hilda's ticket 10:00–13:30, but its segments end at 12:00: the stretch is hers.
    const stretched = appt(HILDA, '10:00', '13:30', {
        services: [
            { teamMember: HILDA, startTime: '10:00', endTime: '11:00' },
            { teamMember: ERASTUS, startTime: '11:00', endTime: '12:00' },
        ],
    });

    it("the part past the segments is the top-level performer's time", () => {
        expect(laneBusyRanges([stretched], HILDA, laneOf)).toEqual([{ start: H(10), end: H(11) }, { start: H(12), end: H(13, 30) }]);
        expect(laneBusyRanges([stretched], ERASTUS, laneOf)).toEqual([{ start: H(11), end: H(12) }]);
    });

    it('an unstretched ticket adds nothing', () => {
        const ticket = appt(HILDA, '10:00', '12:00', { services: stretched.services });
        expect(laneBusyRanges([ticket], HILDA, laneOf)).toEqual([{ start: H(10), end: H(11) }]);
    });
});

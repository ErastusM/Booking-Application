import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import StaffLanesDay from './StaffLanesDay';
import CalendarGrid from '../../components/CalendarGrid';

// The owner's answer (Q3): "Yes. Own hours." — each lane of the Staff view, and
// a single person's calendar, is shaded by that person's OWN hours for the day
// (the owner's lane by the business's Working Hours). These pin the shading
// arithmetic; GET /api/team/hours (API tests) pins the hours themselves.

const HOUR_PX = 64; // StaffLanesDay's
const WED = new Date(2026, 9, 21, 12); // Wednesday 21 October 2026
const WED_KEY = '2026-10-21';
const business = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    .map((d) => [d, { enabled: true, slots: [{ start: '08:00', end: '18:00' }] }]));
const team = [
    { _id: 'erastus', name: 'Erastus', role: 'Barber', color: '#3B82F6' },
    { _id: 'john', name: 'John', role: 'Barber', color: '#10B981' },
];
const lanes = (laneHours) => render(
    <StaffLanesDay date={WED} onDateChange={() => {}} ownerName="Vido" teamMembers={team} staffFilter={new Set()}
        appointments={[]} blockedTimes={[]} availability={business} laneHours={laneHours} statusColors={{ pending: {} }} />
);
// [start, end] minutes of each shaded band in a lane, from its pixel geometry.
const bands = (container, laneId, windowStart) => [...container.querySelectorAll(`[data-lane-id="${laneId}"] [data-testid="staff-lane-off"]`)]
    .map((el) => {
        const top = parseFloat(el.style.top); const h = parseFloat(el.style.height);
        return [windowStart + (top / HOUR_PX) * 60, windowStart + ((top + h) / HOUR_PX) * 60];
    });

describe('Staff view — each lane is shaded by that person\'s own hours', () => {
    const hours = {
        unassigned: { source: 'business', slots: [{ start: '08:00', end: '18:00' }], busy: [] },
        erastus: { source: 'weekly', slots: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }], busy: [] },
        john: { source: 'none', slots: [], busy: [] },
    };

    it('the owner by the business\'s hours, a split day by its two periods, no hours = the whole lane', () => {
        const { container } = lanes(hours);
        // Window: 08:00–18:00 padded an hour each side → 07:00–19:00.
        expect(bands(container, 'unassigned', 420)).toEqual([[420, 480], [1080, 1140]]);
        expect(bands(container, 'erastus', 420)).toEqual([[420, 480], [720, 840], [1080, 1140]]);
        expect(bands(container, 'john', 420)).toEqual([[420, 1140]]);
        expect(container.textContent).toContain('No working hours');
    });

    it('a shift past closing widens the window, and its break is shaded', () => {
        const { container } = lanes({
            ...hours,
            erastus: { source: 'shift', slots: [{ start: '10:00', end: '20:00' }], busy: [{ startTime: '13:00', endTime: '13:30', kind: 'break' }] },
        });
        // Window now 07:00–21:00.
        expect(bands(container, 'erastus', 420)).toEqual([[420, 600], [1200, 1260], [780, 810]]);
        expect(bands(container, 'unassigned', 420)).toEqual([[420, 480], [1080, 1260]]);
    });

    it('until the hours arrive, every lane keeps the business\'s shading — never all closed', () => {
        const { container } = lanes(null);
        ['unassigned', 'erastus', 'john'].forEach((id) => expect(bands(container, id, 420)).toEqual([[420, 480], [1080, 1140]]));
    });

    it('leave reads "On leave"', () => {
        const { container } = lanes({ ...hours, john: { source: 'leave', slots: [], busy: [] } });
        expect(container.textContent).toContain('On leave');
        expect(bands(container, 'john', 420)).toEqual([[420, 1140]]);
    });
});

describe('a single person\'s calendar is shaded by their own hours', () => {
    const CAL_HOUR_PX = 76;
    const grid = (hoursByDate, availability = business) => render(
        <CalendarGrid view="day" date={WED} onDateChange={() => {}} appointments={[]} blockedTimes={[]}
            teamMembers={team} availability={availability} hoursByDate={hoursByDate} />
    );
    const dayBands = (container) => [...container.querySelectorAll(`[data-day="${WED_KEY}"] .staff-lane-offhours`)]
        .map((el) => [parseFloat(el.style.top) / CAL_HOUR_PX * 60, (parseFloat(el.style.top) + parseFloat(el.style.height)) / CAL_HOUR_PX * 60]);

    it('their split day and break, not the business\'s hours', () => {
        const { container } = grid({ [WED_KEY]: { source: 'weekly', slots: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }], busy: [{ startTime: '15:00', endTime: '15:30' }] } });
        expect(dayBands(container)).toEqual([[0, 540], [720, 780], [1020, 1440], [900, 930]]);
    });

    it('no hours that day shades the whole day', () => {
        const { container } = grid({ [WED_KEY]: { source: 'none', slots: [], busy: [] } });
        expect(dayBands(container)).toEqual([[0, 1440]]);
    });

    it('without their hours (not loaded, or another day) it falls back to the given availability', () => {
        const { container } = grid(null);
        expect(dayBands(container)).toEqual([[0, 480], [1080, 1440]]);
        const none = grid({}, null);
        expect(dayBands(none.container)).toEqual([]);
    });
});

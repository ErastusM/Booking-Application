import { describe, it, expect } from 'vitest';
import { editableWeek, sortedWeek, weekProblem, secondPeriodFor } from './workingHours';

// Split days (the owner's answer, Q4: "Yes"): a day can have a second period
// after a break, on the Working Hours screen and on a member's Team card.

const day = (...slots) => ({ enabled: true, slots });

describe('weekProblem — the same rules the server applies, named by day', () => {
    it('accepts one period, a split day with a break, and days off', () => {
        expect(weekProblem({
            monday: day({ start: '08:00', end: '17:00' }),
            tuesday: day({ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }),
            wednesday: { enabled: false, slots: [] },
        })).toBeNull();
    });

    it('refuses overlapping or touching periods, naming the day and where the second must start', () => {
        expect(weekProblem({ friday: day({ start: '08:00', end: '13:00' }, { start: '12:00', end: '18:00' }) }))
            .toBe('Friday: the two periods overlap — the second must start after 13:00, leaving a break between them.');
        expect(weekProblem({ friday: day({ start: '08:00', end: '12:00' }, { start: '12:00', end: '18:00' }) }))
            .toMatch(/^Friday: the two periods overlap/);
        // Order entered doesn't matter.
        expect(weekProblem({ friday: day({ start: '14:00', end: '18:00' }, { start: '08:00', end: '12:00' }) })).toBeNull();
    });

    it('refuses a period that ends before it starts — saying which one — in the screen\'s own words', () => {
        expect(weekProblem({ monday: day({ start: '17:00', end: '09:00' }) }))
            .toBe('Monday: the closing time must be after the opening time.');
        expect(weekProblem({ monday: day({ start: '08:00', end: '12:00' }, { start: '15:00', end: '14:00' }) }, { words: ['start', 'end'] }))
            .toBe('Monday: the end time of the second period must be after the start time.');
        expect(weekProblem({ monday: { enabled: true, slots: [] } })).toMatch(/^Monday: set the opening and closing time/);
    });
});

describe('what is shown is what is saved', () => {
    it('editableWeek keeps every period, in time order; a day on with no times shows off', () => {
        const week = editableWeek({
            monday: { enabled: true, slots: [{ _id: 'b', start: '14:00', end: '18:00' }, { _id: 'a', start: '08:00', end: '12:00' }] },
            tuesday: { enabled: true, slots: [] },
        });
        expect(week.monday).toEqual({ enabled: true, slots: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }] });
        expect(week.tuesday.enabled).toBe(false);
        expect(Object.keys(week)).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
    });

    it('periods saved touching (before the screens refused it) load as the one period bookings read', () => {
        const week = editableWeek({
            monday: { enabled: true, slots: [{ start: '12:00', end: '18:00' }, { start: '08:00', end: '12:00' }] },
            tuesday: { enabled: true, slots: [{ start: '08:00', end: '13:00' }, { start: '12:00', end: '14:00' }] },
        });
        expect(week.monday.slots).toEqual([{ start: '08:00', end: '18:00' }]);
        expect(week.tuesday.slots).toEqual([{ start: '08:00', end: '14:00' }]);
        // …so the week saves again without "the two periods overlap".
        expect(weekProblem(week)).toBeNull();
    });

    it('sortedWeek saves periods in time order, with nothing but start and end', () => {
        expect(sortedWeek({ monday: day({ start: '14:00', end: '18:00', _id: 'x' }, { start: '08:00', end: '12:00' }) }))
            .toEqual({ monday: { enabled: true, slots: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }] } });
    });
});

describe('"+ Add a break / second period"', () => {
    it('splits a day that spans lunchtime around 12:00–13:00', () => {
        expect(secondPeriodFor({ start: '08:00', end: '18:00' }))
            .toEqual({ first: { start: '08:00', end: '12:00' }, second: { start: '13:00', end: '18:00' } });
    });

    it('otherwise adds an hour, an hour after the first period ends', () => {
        expect(secondPeriodFor({ start: '07:00', end: '11:00' }))
            .toEqual({ first: { start: '07:00', end: '11:00' }, second: { start: '12:00', end: '13:00' } });
        expect(secondPeriodFor({ start: '14:00', end: '17:30' }).second).toEqual({ start: '18:30', end: '19:30' });
    });

    it('never runs past the end of the day, and offers nothing when there is no room', () => {
        expect(secondPeriodFor({ start: '15:00', end: '22:30' }).second).toEqual({ start: '23:30', end: '23:59' });
        expect(secondPeriodFor({ start: '15:00', end: '23:00' })).toBeNull();
        expect(secondPeriodFor({ start: '15:00', end: '09:00' })).toBeNull();
    });
});

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TeamHoursBanner from './TeamHoursBanner';

// The owner's calendar says which team members clients can't book because they
// have no working hours of their own — the owner shouldn't have to open Team to
// find out that nobody can book Hilda.

const show = (members) => render(<MemoryRouter><TeamHoursBanner members={members} /></MemoryRouter>);

describe('TeamHoursBanner — members clients can’t book', () => {
    it('names one member without hours and links to Team', () => {
        show([
            { _id: 'a', name: 'Hilda Nangolo', hasHours: false },
            { _id: 'b', name: 'Erastus', hasHours: true },
        ]);
        const banner = screen.getByTestId('team-hours-banner');
        expect(banner).toHaveTextContent('Hilda can’t be booked — no working hours set');
        expect(banner.getAttribute('href')).toBe('/team');
    });

    it('names two, counts more', () => {
        const { unmount } = show([{ name: 'Hilda', hasHours: false }, { name: 'Lina', hasHours: false }]);
        expect(screen.getByTestId('team-hours-banner')).toHaveTextContent('Hilda and Lina can’t be booked');
        unmount();
        show([{ name: 'A', hasHours: false }, { name: 'B', hasHours: false }, { name: 'C', hasHours: false }]);
        expect(screen.getByTestId('team-hours-banner')).toHaveTextContent('3 team members can’t be booked — no working hours set');
    });

    it('stays away when everyone can be booked, and ignores front desk, former members and an older API', () => {
        show([
            { name: 'Ready', hasHours: true },
            { name: 'Desk', hasHours: false, bookable: false },
            { name: 'Gone', hasHours: false, isActive: false },
            { name: 'Old API' },
        ]);
        expect(screen.queryByTestId('team-hours-banner')).toBeNull();
    });
});

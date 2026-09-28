import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkingHoursEditor from './WorkingHoursEditor';

// The one Working Hours screen: the owner's own hours, a team member's own
// hours, and the owner setting a member's hours on Team all draw this.

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const baseWeek = () => ({
    ...Object.fromEntries(DAYS.map((d) => [d, { enabled: false, slots: [{ start: '09:00', end: '17:00' }] }])),
    monday: { enabled: true, slots: [{ start: '08:00', end: '20:00' }] },
    tuesday: { enabled: true, slots: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }] },
});

const Harness = ({ onState, onSave = () => {}, ...rest }) => {
    const [week, setWeek] = useState(baseWeek());
    onState?.(week);
    return <WorkingHoursEditor week={week} onChange={setWeek} onSave={onSave} {...rest} />;
};

describe('WorkingHoursEditor', () => {
    it('draws one row per weekday, with times on working days and "Not available" on days off', () => {
        render(<Harness title="Working Hours" subtitle="Set the days and hours clients can book you." />);
        expect(screen.getByRole('heading', { name: 'Working Hours' })).toBeInTheDocument();
        expect(screen.getByText('Set the days and hours clients can book you.')).toBeInTheDocument();
        DAYS.forEach((d) => expect(screen.getByRole('switch', { name: `Open on ${d}` })).toBeInTheDocument());

        const mon = screen.getByTestId('hours-row-monday');
        expect(within(mon).getByRole('combobox', { name: 'Monday opening time' })).toHaveTextContent('08:00');
        expect(within(mon).getByRole('combobox', { name: 'Monday closing time' })).toHaveTextContent('20:00');
        expect(screen.getByRole('switch', { name: 'Open on monday' })).toHaveAttribute('aria-checked', 'true');

        // A split day shows both periods.
        const tue = screen.getByTestId('hours-row-tuesday');
        expect(within(tue).getByRole('combobox', { name: 'Tuesday second period opening time' })).toHaveTextContent('13:00');
        expect(within(tue).getByRole('combobox', { name: 'Tuesday second period closing time' })).toHaveTextContent('17:00');

        const sun = screen.getByTestId('hours-row-sunday');
        expect(within(sun).getByText('Not available')).toBeInTheDocument();
        expect(within(sun).queryByRole('combobox')).toBeNull();
        expect(screen.getByRole('switch', { name: 'Open on sunday' })).toHaveAttribute('aria-checked', 'false');
    });

    it('the switch turns a day on and off, keeping its times', async () => {
        const state = { current: null };
        render(<Harness onState={(w) => { state.current = w; }} />);
        await userEvent.click(screen.getByRole('switch', { name: 'Open on monday' }));
        expect(state.current.monday).toEqual({ enabled: false, slots: [{ start: '08:00', end: '20:00' }] });
        expect(within(screen.getByTestId('hours-row-monday')).getByText('Not available')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('switch', { name: 'Open on sunday' }));
        expect(state.current.sunday.enabled).toBe(true);
        expect(within(screen.getByTestId('hours-row-sunday')).getByRole('combobox', { name: 'Sunday opening time' })).toHaveTextContent('09:00');
    });

    it('"+ Add a break / second period" splits a day', async () => {
        const state = { current: null };
        render(<Harness onState={(w) => { state.current = w; }} />);
        await userEvent.click(screen.getByRole('button', { name: /Add a break \/ second period on Monday/ }));
        expect(state.current.monday.slots).toHaveLength(2);
    });

    it('Save Changes calls onSave; while saving it is disabled', async () => {
        const onSave = vi.fn();
        const { rerender } = render(<Harness onSave={onSave} />);
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        expect(onSave).toHaveBeenCalledTimes(1);
        rerender(<Harness onSave={onSave} saving />);
        expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    });

    it('shows a notice and a saved message when given', () => {
        render(<Harness notice="Turn on the days you work." success="Your hours are saved." />);
        expect(screen.getByTestId('hours-notice')).toHaveTextContent('Turn on the days you work.');
        expect(screen.getByRole('status')).toHaveTextContent('Your hours are saved.');
    });

    it('every switch has at least a 44px tall hit area', () => {
        render(<Harness />);
        expect(screen.getByRole('switch', { name: 'Open on monday' }).style.height).toBe('44px');
    });
});

// The owner setting a member's hours on Team: the same screen, the member's week.
const svc = vi.hoisted(() => ({
    getMemberAvailability: vi.fn(),
    updateMemberAvailability: vi.fn(),
}));
vi.mock('../services', () => ({ teamService: svc, providerServiceService: {} }));
vi.mock('../context/AuthContext', () => ({ useAuthContext: () => ({ user: { _id: 'owner' } }) }));

const { MemberWorkingHours } = await import('../pages/Team');

describe('Team — a member\'s working hours', () => {
    beforeEach(() => { svc.getMemberAvailability.mockReset(); svc.updateMemberAvailability.mockReset(); });

    it('shows the same Working Hours screen over the member\'s week, and saves it as one repeating week', async () => {
        svc.getMemberAvailability.mockResolvedValue({ data: { data: { schedule: baseWeek() } } });
        svc.updateMemberAvailability.mockResolvedValue({ data: { data: {} } });
        const onChanged = vi.fn();
        render(<MemberWorkingHours member={{ _id: 'm1', name: 'Erastus Nangolo' }} onChanged={onChanged} />);

        expect(await screen.findByRole('heading', { name: 'Erastus’s working hours' })).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'Open on monday' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('switch', { name: 'Open on sunday' })).toHaveAttribute('aria-checked', 'false');
        // No per-date editors on this screen any more.
        expect(screen.queryByText(/shift/i)).toBeNull();
        expect(screen.queryByText(/time off/i)).toBeNull();

        await userEvent.click(screen.getByRole('switch', { name: 'Open on wednesday' }));
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() => expect(svc.updateMemberAvailability).toHaveBeenCalledTimes(1));
        const [id, week, rotation] = svc.updateMemberAvailability.mock.calls[0];
        expect(id).toBe('m1');
        expect(week.wednesday).toEqual({ enabled: true, slots: [{ start: '09:00', end: '17:00' }] });
        expect(week.tuesday.slots).toHaveLength(2);
        expect(rotation).toBeNull();
        expect(await screen.findByRole('status')).toHaveTextContent('Erastus’s hours are saved.');
        expect(onChanged).toHaveBeenCalled();
    });

    it('a member with no hours yet shows every day off and says clients can\'t book them', async () => {
        svc.getMemberAvailability.mockResolvedValue({ data: { data: null } });
        render(<MemberWorkingHours member={{ _id: 'm2', name: 'Alex Rivera' }} />);
        expect(await screen.findByTestId('no-hours-note')).toHaveTextContent('Alex can’t be booked until you turn on a day');
        DAYS.forEach((d) => expect(screen.getByRole('switch', { name: `Open on ${d}` })).toHaveAttribute('aria-checked', 'false'));
    });

    it('an old rotating cycle is named, since saving replaces it', async () => {
        svc.getMemberAvailability.mockResolvedValue({ data: { data: { schedule: baseWeek(), rotation: { anchor: '2026-09-07', weeks: [baseWeek(), baseWeek()] } } } });
        render(<MemberWorkingHours member={{ _id: 'm3', name: 'Moses' }} />);
        expect(await screen.findByTestId('hours-notice')).toHaveTextContent('2-week cycle');
    });
});

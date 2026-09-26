import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DayPeriods from './DayPeriods';

// The Working Hours screen's day row (the owner's business hours, and a team
// member's own — the same screen): add a second period after a break, edit
// either period, remove the second again.

const Harness = ({ initial, onState }) => {
    const [periods, setPeriods] = useState(initial);
    onState(periods);
    return <DayPeriods day="monday" periods={periods} onChange={setPeriods} />;
};
const setup = (initial) => {
    const state = { current: initial };
    render(<Harness initial={initial} onState={(p) => { state.current = p; }} />);
    return state;
};
const pick = async (label, hour, minute) => {
    await userEvent.click(screen.getByRole('combobox', { name: label }));
    await userEvent.click(within(screen.getByRole('listbox', { name: 'Hour' })).getByRole('option', { name: hour }));
    await userEvent.click(within(screen.getByRole('listbox', { name: 'Minute' })).getByRole('option', { name: minute }));
    await userEvent.keyboard('{Escape}');
};

describe('DayPeriods — split days on the Working Hours screen', () => {
    it('"+ Add a break / second period" splits the day around lunch, and each period is editable', async () => {
        const state = setup([{ start: '08:00', end: '18:00' }]);
        expect(screen.queryByRole('combobox', { name: 'Monday second period opening time' })).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: /Add a break \/ second period on Monday/ }));
        expect(state.current).toEqual([{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }]);
        expect(screen.getByRole('combobox', { name: 'Monday opening time' })).toHaveTextContent('08:00');
        expect(screen.getByRole('combobox', { name: 'Monday closing time' })).toHaveTextContent('12:00');
        expect(screen.getByRole('combobox', { name: 'Monday second period opening time' })).toHaveTextContent('13:00');
        // Two periods is the most: no add button now.
        expect(screen.queryByRole('button', { name: /Add a break/ })).toBeNull();

        await pick('Monday second period opening time', '14', '30');
        expect(state.current[1]).toEqual({ start: '14:30', end: '18:00' });
        await pick('Monday closing time', '12', '30');
        expect(state.current[0]).toEqual({ start: '08:00', end: '12:30' });
    });

    it('removes the second period again', async () => {
        const state = setup([{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }]);
        await userEvent.click(screen.getByRole('button', { name: 'Remove Monday’s second period' }));
        expect(state.current).toEqual([{ start: '08:00', end: '12:00' }]);
        expect(screen.getByRole('button', { name: /Add a break \/ second period on Monday/ })).toBeInTheDocument();
    });

    it('the first period can\'t be removed', () => {
        setup([{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }]);
        expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(1);
    });
});

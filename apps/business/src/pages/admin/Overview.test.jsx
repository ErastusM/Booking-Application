import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The overview's "Needs you": one row per thing waiting, with a link to where
 * it is handled; a calm empty state; and an error when the counts could not
 * be loaded (rather than "nothing needs you").
 */
const svc = vi.hoisted(() => ({ analyticsService: {}, appointmentService: {} }));
vi.mock('../../services', () => svc);

import Overview from './Overview';
import { AdminData } from './adminData';
import { TwoStepStatus } from '../../components/AdminTwoStep';

beforeEach(() => {
    svc.analyticsService = { getAdminOverview: vi.fn().mockResolvedValue({ data: { data: { appointments: 12, pending: 3, users: 40, activeServices: 9, revenue: 1500 } } }) };
    svc.appointmentService = { getAllAppointments: vi.fn().mockResolvedValue({ data: { data: [] } }) };
});

const base = { money: true, error: false, payments: 0, payouts: 0, applications: 0, requests: 0, cases: 0, topUps: 0, launch: { ready: true, items: [] }, roles: [] };
const renderWith = (counts, twoStep = { recoveryCodesLeft: 8 }) => render(
    <MemoryRouter>
        <TwoStepStatus.Provider value={twoStep}>
            <AdminData.Provider value={{ counts, refresh: vi.fn() }}><Overview /></AdminData.Provider>
        </TwoStepStatus.Provider>
    </MemoryRouter>,
);
const needsYou = () => within(screen.getByTestId('needs-you'));

describe('Overview', () => {
    it('lists what is waiting, each with a link to it', async () => {
        renderWith({ ...base, applications: 2, payouts: 1, payoutsCents: 5000, topUps: 1, launch: { ready: false, items: [{ done: true }, { done: false }] } });
        expect(await screen.findByText('12')).toBeInTheDocument();
        const rows = screen.getAllByTestId('needs-you-row');
        expect(rows.map((r) => r.textContent)).toEqual([
            expect.stringContaining('2 businesses waiting for online payments approval'),
            expect.stringContaining('1 payout due'),
            expect.stringContaining('1 wallet top-up to approve'),
            expect.stringContaining('Go-live checklist: 1 of 2 done'),
        ]);
        expect(within(rows[0]).getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/bkplus-command/money/approvals');
        expect(within(rows[2]).getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/bkplus-command/wallets');
    });

    it('nothing waiting: says so', () => {
        renderWith(base);
        expect(needsYou().getByText('Nothing needs you right now.')).toBeInTheDocument();
    });

    it('counts that failed to load: an error, not "nothing needs you"', () => {
        renderWith({ ...base, error: true });
        expect(needsYou().getByRole('alert')).toHaveTextContent('Could not load what needs you');
        expect(needsYou().queryByText('Nothing needs you right now.')).not.toBeInTheDocument();
    });

    it('recovery codes running low come first, pointing at Admins and roles', () => {
        renderWith(base, { recoveryCodesLeft: 1 });
        const [row] = screen.getAllByTestId('needs-you-row');
        expect(row).toHaveTextContent('1 recovery code left');
        expect(within(row).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/bkplus-command/settings/admins');
    });

    it('without a money role the recovery row has no link it could not open', () => {
        renderWith({ ...base, money: false }, { recoveryCodesLeft: 0 });
        const [row] = screen.getAllByTestId('needs-you-row');
        expect(row).toHaveTextContent('No recovery codes left');
        expect(within(row).queryByRole('link')).not.toBeInTheDocument();
    });
});

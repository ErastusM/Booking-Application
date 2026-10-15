import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * The console shell: one sidebar of sections with counts of what needs
 * someone, the Money and Settings groups only for an admin with a money role,
 * and a menu button that opens the same sidebar as a drawer on a phone.
 */
const svc = vi.hoisted(() => ({ financeService: {}, providerWalletService: {} }));
const ctx = vi.hoisted(() => ({ user: { _id: 'me', name: 'Erastus M.', role: 'admin' }, logout: vi.fn() }));
vi.mock('../../services', () => svc);
vi.mock('../../context/AuthContext', () => ({ useAuthContext: () => ctx }));
vi.mock('../../context/ThemeContext', () => ({ useTheme: () => ({ darkMode: false, toggleDarkMode: vi.fn() }) }));
vi.mock('../../components/NotificationBell', () => ({ default: () => <button type="button">Notifications</button> }));
// The sections have their own tests; here they only say which one is showing.
vi.mock('./Overview', () => ({ default: () => <p>Overview section</p> }));
vi.mock('./Bookings', () => ({ default: () => <p>Bookings section</p> }));
vi.mock('./Users', () => ({ default: () => <p>Users section</p> }));
vi.mock('./Services', () => ({ default: () => <p>Services section</p> }));
vi.mock('./Revenue', () => ({ default: () => <p>Revenue section</p> }));
vi.mock('./Wallets', () => ({ default: () => <p>Wallets section</p> }));
vi.mock('./Insights', () => ({ default: () => <p>Insights section</p> }));
vi.mock('./MoneySection', () => ({ default: ({ view }) => <p>Money section {view || ''}</p> }));

import AdminConsole, { loadCounts } from './AdminConsole';
import { TwoStepStatus } from '../../components/AdminTwoStep';

const ok = (data, extra = {}) => Promise.resolve({ data: { data, ...extra } });

beforeEach(() => {
    svc.financeService = {
        payments: vi.fn(() => ok([], { total: 2 })),
        payoutsDue: vi.fn(() => ok([{ payable: true, amountCents: 5000 }, { payable: false, amountCents: 100 }], { totalPayableCents: 5000, schedule: {} })),
        listApprovals: vi.fn(() => ok([{ _id: 'a', submittedAt: '2026-10-10T00:00:00Z' }])),
        listRequests: vi.fn(() => ok([{ _id: 'r' }, { _id: 's' }])),
        disputes: vi.fn(() => ok([])),
        getSettings: vi.fn(() => ok({ launch: { ready: false, items: [] }, me: { roles: ['director', 'finance'] } })),
    };
    svc.providerWalletService = { getAdminSummary: vi.fn(() => ok({ pendingTopUps: 1 })) };
});

// As in App.jsx: the console's own routes are relative to /bkplus-command/*.
const renderAt = (path, twoStep = { enabled: true, sessionConfirmed: true, recoveryCodesLeft: 8 }) => render(
    <MemoryRouter initialEntries={[path]}>
        <TwoStepStatus.Provider value={twoStep}>
            <Routes>
                <Route path="/bkplus-command/login" element={<p>Admin door</p>} />
                <Route path="/bkplus-command/*" element={<AdminConsole />} />
            </Routes>
        </TwoStepStatus.Provider>
    </MemoryRouter>,
);
const refuse = (status, code) => () => Promise.reject({ response: { status, data: code ? { code } : {} } });

describe('AdminConsole', () => {
    it('shows the sections with what needs someone, and the admin with their roles', async () => {
        renderAt('/bkplus-command');
        const nav = screen.getByRole('navigation', { name: 'Admin' });
        expect(screen.getByText('Overview section')).toBeInTheDocument();
        expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveClass('active');
        // Payments to look at 2, payouts due 1, approvals 1 application + 2 requests, top-ups 1.
        expect(await within(nav).findByRole('link', { name: 'Payments 2 waiting' })).toBeInTheDocument();
        expect(within(nav).getByRole('link', { name: 'Payouts 1 waiting' })).toBeInTheDocument();
        expect(within(nav).getByRole('link', { name: 'Approvals 3 waiting' })).toBeInTheDocument();
        expect(within(nav).getByRole('link', { name: 'Wallets 1 waiting' })).toBeInTheDocument();
        expect(within(nav).getByRole('link', { name: 'Disputes' })).toBeInTheDocument();
        expect(screen.getByText('Director and finance')).toBeInTheDocument();
    });

    it('opens the section in the address; money sections get their view', async () => {
        renderAt('/bkplus-command/money/payouts');
        expect(screen.getByText('Money section')).toBeInTheDocument();
        expect(await screen.findByRole('link', { name: 'Payouts 1 waiting' })).toHaveClass('active');
        await userEvent.click(screen.getByRole('link', { name: 'Users' }));
        expect(screen.getByText('Users section')).toBeInTheDocument();
    });

    it('an admin without a money role has no Money or Settings sections', async () => {
        for (const k of Object.keys(svc.financeService)) svc.financeService[k] = vi.fn(refuse(403, 'finance_role_required'));
        renderAt('/bkplus-command');
        const nav = screen.getByRole('navigation', { name: 'Admin' });
        await vi.waitFor(() => expect(within(nav).queryByRole('link', { name: /Payouts/ })).not.toBeInTheDocument());
        expect(within(nav).queryByRole('link', { name: 'Prices and fees' })).not.toBeInTheDocument();
        expect(within(nav).getByRole('link', { name: 'Users' })).toBeInTheDocument();
    });

    it('a money count that fails to load keeps the Money and Settings sections', async () => {
        svc.financeService.getSettings = vi.fn(refuse(500));
        renderAt('/bkplus-command');
        const nav = screen.getByRole('navigation', { name: 'Admin' });
        expect(await within(nav).findByRole('link', { name: 'Payouts 1 waiting' })).toBeInTheDocument();
        expect(within(nav).getByRole('link', { name: 'Prices and fees' })).toBeInTheDocument();
    });

    it('a failed poll keeps the last good counts', async () => {
        const first = await loadCounts(null);
        expect(first).toMatchObject({ money: true, error: false, payments: 2, payouts: 1, applications: 1, requests: 2, topUps: 1 });
        for (const k of Object.keys(svc.financeService)) svc.financeService[k] = vi.fn(refuse(502));
        svc.providerWalletService.getAdminSummary = vi.fn(refuse(502));
        const next = await loadCounts(first);
        expect(next).toMatchObject({ money: true, error: true, payments: 2, payouts: 1, applications: 1, requests: 2, topUps: 1, roles: ['director', 'finance'] });
    });

    it('the menu button opens the drawer; Close menu, Escape or choosing a section closes it', async () => {
        renderAt('/bkplus-command');
        const shell = screen.getByTestId('admin-console');
        const menu = screen.getByRole('button', { name: 'Open menu' });
        expect(menu).toHaveAttribute('aria-expanded', 'false');

        await userEvent.click(menu);
        expect(shell).toHaveAttribute('data-drawer', 'open');
        expect(menu).toHaveAttribute('aria-expanded', 'true');
        await userEvent.click(screen.getByRole('button', { name: 'Close menu' }));
        expect(shell).toHaveAttribute('data-drawer', 'closed');
        expect(menu).toHaveFocus();

        await userEvent.click(menu);
        await userEvent.keyboard('{Escape}');
        expect(shell).toHaveAttribute('data-drawer', 'closed');

        await userEvent.click(menu);
        await userEvent.click(screen.getByRole('link', { name: 'Insights' }));
        expect(screen.getByText('Insights section')).toBeInTheDocument();
        expect(shell).toHaveAttribute('data-drawer', 'closed');
    });

    it('shows the notifications bell and warns when recovery codes run low', async () => {
        renderAt('/bkplus-command', { enabled: true, sessionConfirmed: true, recoveryCodesLeft: 1 });
        expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('1 recovery code left');
    });

    it('signs out to the admin door', async () => {
        renderAt('/bkplus-command');
        await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
        expect(ctx.logout).toHaveBeenCalled();
        expect(await screen.findByText('Admin door')).toBeInTheDocument();
    });
});

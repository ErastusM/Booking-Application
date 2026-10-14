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
// The sections have their own tests; here they only say which one is showing.
vi.mock('./Overview', () => ({ default: () => <p>Overview section</p> }));
vi.mock('./Bookings', () => ({ default: () => <p>Bookings section</p> }));
vi.mock('./Users', () => ({ default: () => <p>Users section</p> }));
vi.mock('./Services', () => ({ default: () => <p>Services section</p> }));
vi.mock('./Revenue', () => ({ default: () => <p>Revenue section</p> }));
vi.mock('./Wallets', () => ({ default: () => <p>Wallets section</p> }));
vi.mock('./Insights', () => ({ default: () => <p>Insights section</p> }));
vi.mock('./MoneySection', () => ({ default: ({ view }) => <p>Money section {view || ''}</p> }));

import AdminConsole from './AdminConsole';

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
const renderAt = (path) => render(
    <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/bkplus-command/*" element={<AdminConsole />} /></Routes>
    </MemoryRouter>,
);

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
        for (const k of Object.keys(svc.financeService)) svc.financeService[k] = vi.fn(() => Promise.reject({ response: { status: 403, data: { code: 'finance_role_required' } } }));
        renderAt('/bkplus-command');
        const nav = screen.getByRole('navigation', { name: 'Admin' });
        await vi.waitFor(() => expect(within(nav).queryByRole('link', { name: /Payouts/ })).not.toBeInTheDocument());
        expect(within(nav).queryByRole('link', { name: 'Prices and fees' })).not.toBeInTheDocument();
        expect(within(nav).getByRole('link', { name: 'Users' })).toBeInTheDocument();
    });

    it('the menu button opens and closes the drawer; choosing a section closes it', async () => {
        renderAt('/bkplus-command');
        const shell = screen.getByTestId('admin-console');
        const menu = screen.getByRole('button', { name: 'Open menu' });
        expect(menu).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(menu);
        expect(shell).toHaveAttribute('data-drawer', 'open');
        expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
        await userEvent.click(screen.getByRole('link', { name: 'Insights' }));
        expect(screen.getByText('Insights section')).toBeInTheDocument();
        expect(shell).toHaveAttribute('data-drawer', 'closed');
    });

    it('signs out to the admin door', async () => {
        renderAt('/bkplus-command');
        await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
        expect(ctx.logout).toHaveBeenCalled();
    });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { can } from '../utils/permissions';

/**
 * One app, seen through each person's own profile. The owner and a team member
 * get the SAME navbar — same labels, same order — and a member simply doesn't
 * see what their access level can't open. Business-wide areas (Insights,
 * Memberships, Gift cards, Team, Wallet) stay the owner's alone.
 */

let currentUser = null;
vi.mock('../context/AuthContext', () => ({
    useAuthContext: () => ({
        user: currentUser,
        logout: vi.fn(),
        hasCap: (cap) => can(currentUser, cap),
    }),
}));
vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ darkMode: false, toggleDarkMode: vi.fn() }) }));
vi.mock('../services', () => ({
    authService: { getSibling: () => Promise.resolve({ data: { data: null } }) },
    myProfileService: { get: () => Promise.resolve({ data: { data: { _id: 'm1', bookable: true } } }) },
}));
vi.mock('./NotificationBell', () => ({ default: () => null }));
vi.mock('./SuggestionBox', () => ({ default: () => null }));

import Navbar from './Navbar';

const owner = { _id: 'o1', role: 'provider', name: 'Olivia Owner', email: 'o@x.test' };
const member = (staffTier) => ({ _id: `s-${staffTier}`, role: 'staff', staffOf: 'o1', staffTier, name: 'Erastus Member', email: 'e@x.test' });

const renderAs = (user) => {
    currentUser = user;
    return render(<MemoryRouter initialEntries={['/dashboard']}><Navbar /></MemoryRouter>);
};

// The desktop tab row (the first .nav-desktop cluster), as the labels read.
const desktopTabs = (container) => [...container.querySelectorAll('.nav-desktop')[0].children].map((el) => el.textContent.trim());

const openMore = async () => {
    await userEvent.click(screen.getByRole('button', { name: /^more/i }));
};
const moreItems = (container) => {
    const menu = container.querySelector('[data-testid="more-menu"]');
    return menu ? [...menu.querySelectorAll('a')].map((a) => a.textContent) : [];
};

describe('Navbar — one app for the owner and the team', () => {
    beforeEach(() => { currentUser = null; });

    it('the owner sees Calendar · Clients · Earnings · Catalogue · More', () => {
        const { container } = renderAs(owner);
        expect(desktopTabs(container)).toEqual(['Calendar', 'Clients', 'Earnings', 'Catalogue', 'More']);
    });

    it('a team member gets exactly the same row, Earnings included (their own takings)', () => {
        const { container } = renderAs(member('low'));
        const tabs = desktopTabs(container);
        expect(tabs).toEqual(['Calendar', 'Clients', 'Earnings', 'Catalogue', 'More']);
        // The old member-only tabs are gone.
        expect(tabs).not.toContain('My services');
        expect(tabs).not.toContain('My hours');
        expect(tabs).not.toContain('Account');
    });

    it("the More menu keeps the owner's order and hides only the business-wide items", async () => {
        const { container: c1, unmount } = renderAs(owner);
        await openMore();
        // Gift cards carries a "Soon" badge while the wallet is coming soon.
        expect(moreItems(c1)).toEqual(['Waiting list', 'Insights', 'Messages', 'Memberships', 'Gift cardsSoon', 'Team']);
        unmount();

        const { container: c2 } = renderAs(member('low'));
        await openMore();
        expect(moreItems(c2)).toEqual(['Waiting list', 'Messages']);
    });

    it('every member gets the same menus, whatever level they once had', async () => {
        for (const tier of ['basic', 'medium', 'high']) {
            const { container, unmount } = renderAs(member(tier));
            expect(desktopTabs(container)).toEqual(['Calendar', 'Clients', 'Earnings', 'Catalogue', 'More']);
            await openMore();
            expect(moreItems(container)).toEqual(['Waiting list', 'Messages']);
            unmount();
        }
    });

    it('the avatar menu has the Settings group for a member too — their own Availability, never the Wallet or Forms', async () => {
        renderAs(member('high'));
        await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
        const menu = screen.getByText('Settings').parentElement;
        expect(within(menu).getByText('My account')).toBeTruthy();
        expect(within(menu).getByText('Availability')).toBeTruthy();
        expect(within(menu).queryByText('Wallet')).toBeNull();
        expect(within(menu).queryByText('Forms')).toBeNull();
    });
});

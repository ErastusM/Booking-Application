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

    it('a Service provider gets the same row in the same order, not a different app', () => {
        const { container } = renderAs(member('low'));
        const tabs = desktopTabs(container);
        expect(tabs[0]).toBe('Calendar');
        expect(tabs[1]).toBe('Clients');
        expect(tabs).toContain('Catalogue');
        expect(tabs[tabs.length - 1]).toBe('More');
        // The old member-only tabs are gone.
        expect(tabs).not.toContain('My services');
        expect(tabs).not.toContain('My hours');
        expect(tabs).not.toContain('Account');
    });

    it("the More menu keeps the owner's order and hides only the business-wide items", async () => {
        const { container: c1, unmount } = renderAs(owner);
        await openMore();
        expect(moreItems(c1)).toEqual(['Waiting list', 'Insights', 'Messages', 'Memberships', 'Gift cards', 'Team']);
        unmount();

        const { container: c2 } = renderAs(member('low'));
        await openMore();
        expect(moreItems(c2)).toEqual(['Waiting list', 'Messages']);
    });

    it('a View-only member has no Waiting list (their level cannot manage it) but still has Messages', async () => {
        const { container } = renderAs(member('basic'));
        await openMore();
        expect(moreItems(container)).toEqual(['Messages']);
    });

    it('the avatar menu has the Settings group for a member too — their own Availability, never the Wallet', async () => {
        renderAs(member('low'));
        await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
        const menu = screen.getByText('Settings').parentElement;
        expect(within(menu).getByText('My account')).toBeTruthy();
        expect(within(menu).getByText('Availability')).toBeTruthy();
        expect(within(menu).queryByText('Wallet')).toBeNull();
        // Forms needs forms:manage (Reception and up).
        expect(within(menu).queryByText('Forms')).toBeNull();
    });

    it('Reception sees Forms under Settings; still no Wallet', async () => {
        renderAs(member('medium'));
        await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
        const menu = screen.getByText('Settings').parentElement;
        expect(within(menu).getByText('Forms')).toBeTruthy();
        expect(within(menu).queryByText('Wallet')).toBeNull();
    });

    it('even a Manager never gets Team, Insights, Memberships, Gift cards or Wallet in the menus', async () => {
        const { container } = renderAs(member('high'));
        await openMore();
        const items = moreItems(container);
        ['Team', 'Insights', 'Memberships', 'Gift cards'].forEach((l) => expect(items).not.toContain(l));
    });
});

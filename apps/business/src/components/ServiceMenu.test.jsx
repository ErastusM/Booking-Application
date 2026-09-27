import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ServiceMenu, { groupServices, categoriesFromServices, matchesService, performersLine, OTHER_NAME } from './ServiceMenu';

/**
 * The Services tab, as the owner and as a team member see it: the same rows,
 * chips and search for both; performers and category management for the owner
 * only; the business's menu (without its prices) for the member only.
 */

const CATS = [
    { _id: 'c-cuts', name: 'Cuts' },
    { _id: 'c-wash', name: 'Washing' },
    { _id: 'c-empty', name: 'Nails' },
];

// The owner's menu: categories are bare ids (GET /services/my).
const OWNER_SERVICES = [
    { _id: 's1', name: 'Haircut', price: 120, duration: 45, category: 'c-cuts', location: 'Windhoek' },
    { _id: 's2', name: 'Beard trim', price: 60, duration: 20, category: 'c-cuts', ownerPerforms: false },
    { _id: 's3', name: 'Car wash', price: 856.5, duration: 75, category: 'c-wash', ownerPerforms: false },
    { _id: 's4', name: 'Éclat facial', price: 0, duration: 30, category: null },
];

// Moses does everything; Hilda only haircuts; Paul is inactive; Lina is not bookable.
const TEAM = [
    { _id: 'm1', name: 'Moses Kamati', offersAllServices: true },
    { _id: 'm2', name: 'Hilda Iita', offersAllServices: false, services: ['s1'] },
    { _id: 'm3', name: 'Paul Amutenya', isActive: false, offersAllServices: true },
    { _id: 'm4', name: 'Lina N', bookable: false, offersAllServices: true },
];
const NOBODY_TEAM = [{ _id: 'm2', name: 'Hilda Iita', offersAllServices: false, services: ['s1'] }];

// A member's own services: categories are populated (GET /team/mine/services).
const MEMBER_SERVICES = [
    { _id: 's3', name: 'Car wash', price: 150, duration: 45, category: { _id: 'c-wash', name: 'Washing', order: 0, createdAt: '2026-02-01' } },
    { _id: 's5', name: 'Valet', price: 300, duration: 90, category: null },
    { _id: 's1', name: 'Haircut', price: 100, duration: 45, category: { _id: 'c-cuts', name: 'Cuts', order: 0, createdAt: '2026-01-01' } },
];
const MENU_REST = [
    { _id: 's2', name: 'Beard trim', price: 60, duration: 20 },
    { _id: 's6', name: 'Polish', price: 999, duration: 60 },
];

const renderOwner = (props = {}) => {
    const handlers = { onAdd: vi.fn(), onEdit: vi.fn(), onAddCategory: vi.fn(async () => true), onDeleteCategory: vi.fn(async () => true) };
    render(<ServiceMenu role="owner" services={OWNER_SERVICES} categories={CATS} teamMembers={TEAM} currency="NAD" businessName="Vido Barber" {...handlers} {...props} />);
    return handlers;
};
const renderMember = (props = {}) => {
    const handlers = { onAdd: vi.fn(), onEdit: vi.fn(), onAddFromMenu: vi.fn(async () => {}) };
    render(<ServiceMenu role="member" services={MEMBER_SERVICES} menuServices={MENU_REST} teamMembers={TEAM} currency="NAD" businessName="Vido Barber" {...handlers} {...props} />);
    return handlers;
};

const rowOf = (name) => screen.getByRole('button', { name: `Edit ${name}` });
const rowNames = () => screen.getAllByTestId('catalogue-service').map((b) => b.querySelector('.sm-name').textContent);
const groupHeads = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);

describe('ServiceMenu — the owner', () => {
    it('titles the menu with its size and a one-line "+ Add" button', async () => {
        const { onAdd } = renderOwner();
        expect(screen.getByRole('heading', { level: 2, name: 'Services' })).toBeInTheDocument();
        expect(screen.getByTestId('service-menu-count')).toHaveTextContent('4 services on your menu');
        const add = screen.getByRole('button', { name: 'Add service' });
        expect(add).toHaveTextContent('Add');
        expect(add).toHaveAttribute('data-testid', 'add-service');
        await userEvent.click(add);
        expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('says who clients can book for each service', () => {
        renderOwner();
        expect(within(rowOf('Haircut')).getByTestId('catalogue-performers')).toHaveTextContent(/^You · Moses · Hilda$/);
        expect(within(rowOf('Beard trim')).getByTestId('catalogue-performers')).toHaveTextContent(/^Only Moses$/);
        // Inactive (Paul) and not-bookable (Lina) members are never named.
        expect(rowOf('Car wash')).not.toHaveTextContent('Paul');
        expect(rowOf('Car wash')).not.toHaveTextContent('Lina');
    });

    it('warns in the danger style when nobody can be booked for a service', () => {
        renderOwner({ teamMembers: NOBODY_TEAM });
        const meta = rowOf('Beard trim').querySelector('.sm-meta');
        expect(meta).toHaveTextContent('20 min · Nobody offers this — clients can’t book it');
        expect(meta).toHaveAttribute('data-nobody', 'true');
        expect(rowOf('Haircut').querySelector('.sm-meta')).not.toHaveAttribute('data-nobody');
    });

    it('names nobody while the team is still loading (no false "Nobody offers this")', () => {
        renderOwner({ teamMembers: null });
        expect(screen.queryAllByTestId('catalogue-performers')).toHaveLength(0);
        expect(screen.queryByText(/Nobody offers this/)).not.toBeInTheDocument();
    });

    it('shows each row as one button: name, duration · performers · location, money price, chevron', async () => {
        const { onEdit } = renderOwner();
        const haircut = rowOf('Haircut');
        expect(haircut).toHaveAttribute('data-testid', 'catalogue-service');
        expect(haircut.querySelector('.sm-meta')).toHaveTextContent('45 min · You · Moses · Hilda · 📍 Windhoek');
        expect(haircut.querySelector('.sm-price')).toHaveTextContent('N$ 120');
        expect(rowOf('Car wash').querySelector('.sm-price')).toHaveTextContent('N$ 856.50');
        expect(rowOf('Car wash').querySelector('.sm-meta')).toHaveTextContent('1 hr 15 min');
        expect(rowOf('Éclat facial').querySelector('.sm-price')).toHaveTextContent('Free');
        // No switch, Edit or Delete in the row any more: tapping it opens the editor.
        expect(within(haircut).queryByRole('switch')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
        await userEvent.click(haircut);
        expect(onEdit).toHaveBeenCalledWith(OWNER_SERVICES[0]);
    });

    it('groups by category in menu order, A–Z inside, with "Other services" last (never "Featured")', () => {
        renderOwner();
        expect(groupHeads()).toEqual(['Cuts · 2', 'Washing · 1', `${OTHER_NAME} · 1`]);
        expect(rowNames()).toEqual(['Beard trim', 'Haircut', 'Car wash', 'Éclat facial']);
        expect(screen.queryByText(/Featured/)).not.toBeInTheDocument();
    });

    it('has a chip per category with services, which filters the list', async () => {
        renderOwner();
        const chips = screen.getAllByTestId('category-chip');
        expect(chips.map((c) => c.textContent)).toEqual(['All · 4', 'Cuts · 2', 'Washing · 1', 'Other services · 1']);
        expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
        // The empty "Nails" category has no chip.
        expect(screen.queryByRole('button', { name: /^Nails/ })).not.toBeInTheDocument();

        await userEvent.click(chips[3]);
        expect(chips[3]).toHaveAttribute('aria-pressed', 'true');
        expect(chips[0]).toHaveAttribute('aria-pressed', 'false');
        expect(rowNames()).toEqual(['Éclat facial']);
        expect(groupHeads()).toEqual(['Other services · 1']);

        await userEvent.click(chips[0]);
        expect(rowNames()).toHaveLength(4);
    });

    it('shows no chips with fewer than two groups', () => {
        renderOwner({ services: OWNER_SERVICES.filter((s) => s.category === 'c-cuts') });
        expect(screen.queryAllByTestId('category-chip')).toHaveLength(0);
        expect(groupHeads()).toEqual(['Cuts · 2']);
        // The owner still gets the Categories button, on its own.
        expect(screen.getByRole('button', { name: 'Categories' })).toBeInTheDocument();
    });

    it('searches by name, case- and accent-blind, and says when nothing matches', async () => {
        renderOwner();
        const search = screen.getByRole('searchbox', { name: 'Search services' });
        await userEvent.type(search, 'ECLAT');
        expect(rowNames()).toEqual(['Éclat facial']);
        // One group left: no chips.
        expect(screen.queryAllByTestId('category-chip')).toHaveLength(0);

        await userEvent.clear(search);
        await userEvent.type(search, 'zzz');
        expect(screen.queryAllByTestId('catalogue-service')).toHaveLength(0);
        expect(screen.getByText('No services match “zzz”')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(search).toHaveValue('');
        expect(rowNames()).toHaveLength(4);
    });

    it('the search box clear button empties it', async () => {
        renderOwner();
        const search = screen.getByRole('searchbox', { name: 'Search services' });
        await userEvent.type(search, 'hair');
        expect(rowNames()).toEqual(['Haircut']);
        await userEvent.click(screen.getByRole('button', { name: 'Clear service search' }));
        expect(search).toHaveValue('');
    });

    it('manages categories in a sheet: every category with its count, add, delete, Escape closes', async () => {
        const { onAddCategory, onDeleteCategory } = renderOwner();
        const open = screen.getByRole('button', { name: 'Categories' });
        await userEvent.click(open);
        const sheet = screen.getByRole('dialog', { name: 'Categories' });
        expect(sheet).toHaveAttribute('aria-modal', 'true');
        const rows = within(sheet).getAllByTestId('category-row').map((r) => r.textContent);
        expect(rows).toEqual(['Cuts2 services', 'Washing1 service', 'Nails0 services']);
        // Focus moved into the sheet.
        expect(sheet.contains(document.activeElement)).toBe(true);

        await userEvent.type(within(sheet).getByRole('textbox', { name: 'New category name' }), '  Colour ');
        await userEvent.click(within(sheet).getByRole('button', { name: 'Add category' }));
        expect(onAddCategory).toHaveBeenCalledWith('Colour');
        expect(within(sheet).getByRole('textbox', { name: 'New category name' })).toHaveValue('');

        await userEvent.click(within(sheet).getByRole('button', { name: 'Delete Nails' }));
        expect(onDeleteCategory).toHaveBeenCalledWith('c-empty');

        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(open).toHaveFocus();
    });

    it('keeps focus in the sheet when the deleted category\'s row goes', async () => {
        function Live() {
            const [cats, setCats] = React.useState(CATS);
            return (
                <ServiceMenu role="owner" services={OWNER_SERVICES} categories={cats} teamMembers={TEAM}
                    onAddCategory={async () => true}
                    onDeleteCategory={async (id) => { setCats((c) => c.filter((x) => x._id !== id)); return true; }} />
            );
        }
        render(<Live />);
        await userEvent.click(screen.getByRole('button', { name: 'Categories' }));
        const sheet = screen.getByRole('dialog', { name: 'Categories' });
        await userEvent.click(within(sheet).getByRole('button', { name: 'Delete Nails' }));
        expect(within(sheet).queryByText('Nails')).not.toBeInTheDocument();
        expect(sheet.contains(document.activeElement)).toBe(true);
        expect(within(sheet).getByRole('status')).toHaveTextContent('Nails deleted');
    });

    it('keeps Tab inside the Categories sheet', async () => {
        renderOwner();
        await userEvent.click(screen.getByRole('button', { name: 'Categories' }));
        const sheet = screen.getByRole('dialog', { name: 'Categories' });
        await userEvent.type(within(sheet).getByRole('textbox', { name: 'New category name' }), 'X');
        const close = within(sheet).getByRole('button', { name: 'Close' });
        const add = within(sheet).getByRole('button', { name: 'Add category' });
        add.focus();
        await userEvent.tab();
        expect(close).toHaveFocus();
        await userEvent.tab({ shift: true });
        expect(add).toHaveFocus();
    });

    it('closes the Categories sheet from its close button and a tap outside', async () => {
        renderOwner();
        await userEvent.click(screen.getByRole('button', { name: 'Categories' }));
        await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Categories' }));
        const overlay = screen.getByRole('dialog').parentElement;
        await userEvent.click(overlay);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('has an empty state that offers to add the first service', async () => {
        const { onAdd } = renderOwner({ services: [] });
        expect(screen.queryByTestId('service-menu-count')).not.toBeInTheDocument();
        expect(screen.getByText('No services yet')).toBeInTheDocument();
        expect(screen.getByText('Add your first service so clients can book you')).toBeInTheDocument();
        await userEvent.click(within(screen.getByTestId('service-menu-empty')).getByRole('button', { name: 'Add service' }));
        expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('counts one service in the singular', () => {
        renderOwner({ services: [OWNER_SERVICES[0]] });
        expect(screen.getByTestId('service-menu-count')).toHaveTextContent(/^1 service on your menu$/);
    });
});

describe('ServiceMenu — a team member', () => {
    it('is the same screen over their own services, at their prices', () => {
        renderMember();
        expect(screen.getByRole('heading', { level: 2, name: 'Services' })).toBeInTheDocument();
        expect(screen.getByTestId('service-menu-count')).toHaveTextContent('3 services clients can book you for');
        expect(screen.getByRole('button', { name: 'Add service' })).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: 'Search services' })).toBeInTheDocument();
        expect(rowOf('Car wash').querySelector('.sm-price')).toHaveTextContent('N$ 150');
        expect(rowOf('Car wash').querySelector('.sm-meta')).toHaveTextContent('45 min');
    });

    it('never shows who performs a service, even with a roster passed in', () => {
        renderMember();
        expect(screen.queryAllByTestId('catalogue-performers')).toHaveLength(0);
        expect(screen.queryByText(/^You/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Only /)).not.toBeInTheDocument();
        expect(screen.queryByText(/Nobody offers/)).not.toBeInTheDocument();
    });

    it('groups under the owner\'s categories in the owner\'s order, "Other services" last, with the same chips', async () => {
        renderMember();
        expect(groupHeads().slice(0, 3)).toEqual(['Cuts · 1', 'Washing · 1', 'Other services · 1']);
        const chips = screen.getAllByTestId('category-chip');
        expect(chips.map((c) => c.textContent)).toEqual(['All · 3', 'Cuts · 1', 'Washing · 1', 'Other services · 1']);
        await userEvent.click(chips[2]);
        expect(rowNames()).toEqual(['Car wash']);
    });

    it('never manages categories', () => {
        renderMember();
        expect(screen.queryByRole('button', { name: 'Categories' })).not.toBeInTheDocument();
        expect(screen.queryByTestId('manage-categories')).not.toBeInTheDocument();
    });

    it('opens the editor from a row', async () => {
        const { onEdit } = renderMember();
        await userEvent.click(rowOf('Valet'));
        expect(onEdit).toHaveBeenCalledWith(MEMBER_SERVICES[1]);
    });

    it('lists the business\'s other services without their prices, each with "+ Add"', async () => {
        const { onAddFromMenu } = renderMember();
        const menu = screen.getByTestId('menu-services');
        expect(within(menu).getByRole('heading', { name: 'Also on Vido Barber’s menu' })).toBeInTheDocument();
        expect(menu).toHaveTextContent('Add one you also do. You can set your own price after.');
        expect(menu).toHaveTextContent('Beard trim');
        expect(menu).toHaveTextContent('20 min');
        // The owner's prices are never shown.
        expect(menu).not.toHaveTextContent('N$');
        expect(menu).not.toHaveTextContent('999');
        expect(menu).not.toHaveTextContent('60 min · N$');

        const add = within(menu).getByRole('button', { name: 'Add Polish to my services' });
        expect(add).toHaveAttribute('data-testid', 'menu-add-service');
        await userEvent.click(add);
        expect(onAddFromMenu).toHaveBeenCalledWith(MENU_REST[1]);
    });

    it('searches their menu section too, and hides it when nothing is left', async () => {
        renderMember();
        const search = screen.getByRole('searchbox', { name: 'Search services' });
        await userEvent.type(search, 'polish');
        expect(within(screen.getByTestId('menu-services')).getAllByTestId('menu-add-service')).toHaveLength(1);
        expect(screen.getByText('No services match “polish”')).toBeInTheDocument();
        await userEvent.clear(search);
        await userEvent.type(search, 'valet');
        expect(screen.queryByTestId('menu-services')).not.toBeInTheDocument();
        expect(rowNames()).toEqual(['Valet']);
    });

    it('has the same empty state as the owner', () => {
        renderMember({ services: [], menuServices: [] });
        expect(screen.getByText('No services yet')).toBeInTheDocument();
        expect(screen.getByText('Add your first service so clients can book you')).toBeInTheDocument();
        expect(screen.queryByTestId('menu-services')).not.toBeInTheDocument();
    });
});

describe('ServiceMenu helpers', () => {
    it('matches names case- and accent-blind', () => {
        expect(matchesService({ name: 'Éclat facial' }, 'eclat')).toBe(true);
        expect(matchesService({ name: 'Haircut' }, '  HAIR ')).toBe(true);
        expect(matchesService({ name: 'Haircut' }, '')).toBe(true);
        expect(matchesService({ name: 'Haircut' }, 'wash')).toBe(false);
    });

    it('puts a service whose category is gone under "Other services"', () => {
        const groups = groupServices([{ _id: 'a', name: 'A', category: 'deleted' }], CATS);
        expect(groups.map((g) => g.name)).toEqual([OTHER_NAME]);
    });

    it('orders a member\'s categories as the owner\'s menu does (order, then age)', () => {
        const cats = categoriesFromServices([
            { category: { _id: 'b', name: 'B', order: 0, createdAt: '2026-03-01' } },
            { category: { _id: 'a', name: 'A', order: 1, createdAt: '2026-01-01' } },
            { category: { _id: 'c', name: 'C', order: 0, createdAt: '2026-02-01' } },
            { category: null },
        ]);
        expect(cats.map((c) => c._id)).toEqual(['c', 'b', 'a']);
    });

    it('reads performers as the owner row says them', () => {
        expect(performersLine({ _id: 's1' }, TEAM).text).toBe('You · Moses · Hilda');
        expect(performersLine({ _id: 's9', ownerPerforms: false }, TEAM).text).toBe('Only Moses');
        expect(performersLine({ _id: 's9', ownerPerforms: false }, []).nobody).toBe(true);
        expect(performersLine({ _id: 's9' }, null)).toBeNull();
    });
});

import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClientPicker, { HEAD_H, ROW_H, matchesClient } from './ClientPicker';

/**
 * The New Appointment client list. jsdom has no layout, so the list renders
 * its 480px fallback window; that is enough to prove the windowing (only a
 * slice of a 1,000-client roster is in the DOM) and that a jump scrolls to and
 * renders the letter's section.
 */
const row = (id, name, extra = {}) => ({
    customer: { _id: id, name, email: extra.email ?? `${id}@mail.test`, phone: extra.phone ?? null, avatar: extra.avatar ?? null },
    isWalkIn: !!extra.isWalkIn,
    visits: extra.visits ?? 1,
    lastVisit: extra.lastVisit ?? '2024-03-04T10:00:00.000Z',
});

const ROSTER = [
    row('u1', 'amber Stone', { phone: '+264 81 123 4567', visits: 3 }),
    row('u2', 'Émile Zola', { phone: '+264 81 555 0000' }),
    row('u3', 'Adriel Nangolo', { avatar: 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg', visits: 12 }),
    row('u4', 'Bruno Mars'),
    row('u5', 'Carla Bruni'),
    row('u6', 'Mia Wallace'),
    row('u7', 'Marcus Aurelius'),
    row('u8', 'Zed Zulu'),
    row('walkin:tom walker', 'Tom Walker', { isWalkIn: true, email: null }),
    row('u9', '', { email: 'nameless@mail.test' }),
];

function Harness({ clients = ROSTER, initial = '', onPick = () => {}, ...rest }) {
    const [value, setValue] = useState(initial);
    return (
        <ClientPicker
            clients={clients}
            value={value}
            onChange={(id) => { setValue(id); onPick(id); }}
            data-testid="appt-client"
            {...rest}
        />
    );
}

const optionNames = () => screen.getAllByRole('option').map((o) => o.querySelector('.cp-name').textContent);

describe('ClientPicker', () => {
    it('lists clients A–Z (case- and accent-blind, nameless last) under letter headers', () => {
        render(<Harness />);
        expect(optionNames()).toEqual([
            'Adriel Nangolo', 'amber Stone', 'Bruno Mars', 'Carla Bruni', 'Émile Zola',
            'Marcus Aurelius', 'Mia Wallace', 'Tom Walker', 'Zed Zulu', 'nameless@mail.test',
        ]);
        const list = screen.getByTestId('appt-client-list');
        const heads = [...list.querySelectorAll('.cp-canvas > .cp-head')].map((h) => h.textContent);
        expect(heads).toEqual(['A', 'B', 'C', 'E', 'M', 'T', 'Z', 'No name']);
    });

    it('puts digit/symbol names under a leading "#", keeps "Łucja" inside L, and "#" is first on the rail', () => {
        render(<Harness clients={[...ROSTER, row('d1', '3M Auto'), row('l1', 'Lars Ulrich'), row('l2', 'Łucja Nowak')]} />);
        const heads = [...screen.getByTestId('appt-client-list').querySelectorAll('.cp-canvas > .cp-head')].map((h) => h.textContent);
        // (Only a window is rendered: the rest of the headers are further down.)
        expect(heads.slice(0, 7)).toEqual(['#', 'A', 'B', 'C', 'E', 'L', 'M']);
        expect(screen.getByTestId('appt-client-option-l2')).toHaveAttribute('data-letter', 'L');
        const rail = screen.getAllByRole('button', { name: /^Jump to/ }).map((b) => b.textContent);
        expect(rail[0]).toBe('#');
        expect(rail).toHaveLength(27);
        expect(screen.getByRole('button', { name: 'Jump to Q (no clients)' })).toBeInTheDocument();
    });

    it('shows picture or initials, phone, visits, last visit, and marks walk-ins', () => {
        render(<Harness />);
        const adriel = screen.getByTestId('appt-client-option-u3');
        const img = adriel.querySelector('img');
        expect(img).toHaveAttribute('loading', 'lazy');
        expect(img.getAttribute('src')).toContain('c_fill');
        expect(adriel).toHaveTextContent('12 visits');
        expect(adriel).toHaveTextContent('last visit Mar 4, 2024');

        const amber = screen.getByTestId('appt-client-option-u1');
        expect(amber.querySelector('img')).toBeNull();
        expect(amber.querySelector('.cp-initials')).toHaveTextContent('AS');
        expect(amber).toHaveTextContent('+264 81 123 4567');
        expect(amber).toHaveTextContent('3 visits');

        expect(screen.getByTestId('appt-client-option-walkin:tom walker')).toHaveTextContent('Walk-in');
        expect(screen.getByTestId('appt-client-option-u4')).toHaveTextContent('1 visit');
    });

    it('filters by name (accent-blind), phone (any spacing) and email', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        const search = screen.getByTestId('appt-client-search');

        await user.type(search, 'emile');
        expect(optionNames()).toEqual(['Émile Zola']);

        await user.clear(search);
        await user.type(search, '811234567');
        expect(optionNames()).toEqual(['amber Stone']);

        await user.clear(search);
        await user.type(search, '81 555');
        expect(optionNames()).toEqual(['Émile Zola']);

        await user.clear(search);
        await user.type(search, 'u5@mail');
        expect(optionNames()).toEqual(['Carla Bruni']);

        await user.clear(search);
        await user.type(search, 'nobody');
        expect(screen.queryAllByRole('option')).toHaveLength(0);
        expect(screen.getByTestId('appt-client-list')).toHaveTextContent('No clients match “nobody”');

        // The rail is hidden while searching; clearing brings everything back.
        expect(screen.queryByTestId('appt-client-rail')).toBeNull();
        await user.click(screen.getByTestId('appt-client-clear'));
        expect(screen.getAllByRole('option')).toHaveLength(ROSTER.length);
        expect(screen.getByTestId('appt-client-rail')).toBeInTheDocument();
    });

    it('matchesClient ignores a short digit run and matches phone digits', () => {
        const c = row('x', 'X', { phone: '+1 (555) 010-2030' });
        expect(matchesClient(c, '5550102')).toBe(true);
        expect(matchesClient(c, '(555) 010')).toBe(true);
        expect(matchesClient(c, '99')).toBe(false);
    });

    it('picks a row on click (radio-style: one aria-selected) and reports the id', async () => {
        const user = userEvent.setup();
        const onPick = vi.fn();
        render(<Harness onPick={onPick} />);
        await user.click(screen.getByTestId('appt-client-option-u4'));
        expect(onPick).toHaveBeenCalledWith('u4');
        expect(screen.getByTestId('appt-client-option-u4')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(1);
        expect(screen.getByTestId('appt-client')).toHaveAttribute('data-value', 'u4');
        expect(screen.getByTestId('appt-client-picked')).toHaveTextContent('Booking for Bruno Mars');

        // A walk-in keeps its walkin: id (bookingClient books it by name).
        await user.click(screen.getByTestId('appt-client-option-walkin:tom walker'));
        expect(onPick).toHaveBeenLastCalledWith('walkin:tom walker');
    });

    it('keyboard: arrows move, Enter picks, typing a letter jumps and cycles', async () => {
        const user = userEvent.setup();
        const onPick = vi.fn();
        render(<Harness onPick={onPick} />);
        const list = screen.getByRole('listbox', { name: 'Client' });
        const activeName = () => document.getElementById(list.getAttribute('aria-activedescendant')).querySelector('.cp-name').textContent;

        act(() => list.focus());
        expect(activeName()).toBe('Adriel Nangolo');
        await user.keyboard('{ArrowDown}{ArrowDown}');
        expect(activeName()).toBe('Bruno Mars');
        await user.keyboard('{ArrowUp}');
        expect(activeName()).toBe('amber Stone');
        await user.keyboard('{End}');
        expect(activeName()).toBe('nameless@mail.test');
        await user.keyboard('{Home}');
        expect(activeName()).toBe('Adriel Nangolo');

        // Each key a second apart, so they read as separate jumps, not one word.
        let now = 1e12;
        vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
        await user.keyboard('m');
        expect(activeName()).toBe('Marcus Aurelius');
        await user.keyboard('m'); // again: next "M"
        expect(activeName()).toBe('Mia Wallace');
        await user.keyboard('e'); // accent-blind: Émile
        expect(activeName()).toBe('Émile Zola');

        await user.keyboard('{Enter}');
        expect(onPick).toHaveBeenCalledWith('u2');
        vi.mocked(Date.now).mockRestore();
        await user.keyboard('ca'); // typed together: a word, "Ca…"
        expect(activeName()).toBe('Carla Bruni');
        await user.keyboard('{ArrowUp}');
        await user.keyboard(' ');
        expect(onPick).toHaveBeenLastCalledWith('u4');
    });

    it('Enter in the search box never submits the surrounding form', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn((e) => e.preventDefault());
        const onPick = vi.fn();
        render(<form onSubmit={onSubmit}><Harness onPick={onPick} /></form>);
        await user.type(screen.getByTestId('appt-client-search'), 'zed{Enter}');
        expect(onSubmit).not.toHaveBeenCalled();
        expect(onPick).toHaveBeenCalledWith('u8'); // a single match is picked
    });

    it('carries required / invalid / aria-describedby onto the listbox, and the ref focuses it', () => {
        const ref = React.createRef();
        render(<><p id="appt-error">Please choose a client</p><ClientPicker ref={ref} clients={ROSTER} value="" data-testid="appt-client" required invalid aria-describedby="appt-error" /></>);
        const list = screen.getByRole('listbox', { name: 'Client' });
        expect(list).toHaveAttribute('aria-required', 'true');
        expect(list).toHaveAttribute('aria-invalid', 'true');
        expect(list).toHaveAccessibleDescription('Please choose a client');
        expect(screen.getByTestId('appt-client')).toHaveAttribute('data-invalid');
        act(() => ref.current.focus());
        expect(document.activeElement).toBe(list);
    });
});

describe('ClientPicker with a large roster', () => {
    // 1,040 clients, A–Z except "Q" and "X".
    const letters = 'ABCDEFGHIJKLMNOPRSTUVWYZ';
    const big = [];
    for (let i = 0; i < 1040; i += 1) {
        const L = letters[i % letters.length];
        big.push(row(`c${i}`, `${L}${String(i).padStart(4, '0')} Client`));
    }

    it('renders only a window of rows, not all 1,040', () => {
        render(<Harness clients={big} />);
        const rendered = screen.getAllByRole('option');
        expect(rendered.length).toBeGreaterThan(5);
        expect(rendered.length).toBeLessThan(40);
        expect(rendered[0]).toHaveAttribute('aria-setsize', '1040');
    });

    it('tapping a rail letter scrolls to and renders that section', async () => {
        const user = userEvent.setup();
        render(<Harness clients={big} />);
        const rail = screen.getByRole('toolbar', { name: 'Jump to letter' });
        const m = within(rail).getByRole('button', { name: 'Jump to M' });

        expect(screen.queryByText('M0012 Client')).toBeNull(); // far below the first window
        await user.click(m);
        expect(screen.getByText('M0012 Client')).toBeInTheDocument();
        // Scrolled so the M header sits at the top: 12 sections before it
        // (A–L), 43–44 rows each.
        const list = screen.getByTestId('appt-client-list');
        const before = big.filter((c) => c.customer.name[0] < 'M').length;
        expect(list.scrollTop).toBe(12 * HEAD_H + before * ROW_H);
        expect(screen.getByRole('status')).toHaveTextContent('M');
    });

    it('a letter with no clients is labelled so, and jumps to the next letter', async () => {
        const user = userEvent.setup();
        render(<Harness clients={big} />);
        const q = screen.getByRole('button', { name: 'Jump to Q (no clients)' });
        await user.click(q);
        expect(screen.getByText('R0016 Client')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('No clients under Q, showing R');
    });

    it('dragging along the rail jumps letter by letter', () => {
        render(<Harness clients={big} />);
        const rail = screen.getByTestId('appt-client-rail');
        // 27 rail entries (#, A–Z) over 270px: 10px each.
        rail.getBoundingClientRect = () => ({ top: 0, left: 0, right: 32, bottom: 270, width: 32, height: 270, x: 0, y: 0 });
        // jsdom has no PointerEvent; a MouseEvent of the same type carries clientY.
        const pointer = (el, type, clientY) => fireEvent(el, new MouseEvent(type, { bubbles: true, clientY }));
        pointer(screen.getByTestId('appt-client-letter-A'), 'pointerdown', 5);
        pointer(rail, 'pointermove', 235); // index 23 = "W"
        expect(screen.getByText('W0021 Client')).toBeInTheDocument();
        pointer(rail, 'pointerup', 235);
        pointer(rail, 'pointermove', 5); // not dragging any more
        expect(screen.getByText('W0021 Client')).toBeInTheDocument();
    });

    it('the rail is one tab stop; arrows move between letters and Enter jumps', async () => {
        const user = userEvent.setup();
        render(<Harness clients={big} />);
        const a = screen.getByRole('button', { name: 'Jump to A' });
        act(() => a.focus());
        expect(a).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('button', { name: 'Jump to B' })).toHaveAttribute('tabindex', '-1');
        await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
        expect(document.activeElement).toHaveAccessibleName('Jump to D');
        await user.keyboard('{Enter}');
        expect(screen.getByText('D0003 Client')).toBeInTheDocument();
    });
});

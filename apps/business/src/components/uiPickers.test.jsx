import React, { useEffect, useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select, DatePicker, TimePicker, ConfirmProvider, useConfirm, useAlert } from '@bookplus/ui';

/**
 * The app-styled pickers from @bookplus/ui replace native <select>, date and
 * time inputs and window.confirm across both apps. Call sites were written
 * against the native controls, so the property that matters most is that they
 * behave like them where handlers can tell: onChange gets `e.target.value` as a
 * string, times are 24-hour 'HH:MM', dates 'YYYY-MM-DD'.
 *
 * jsdom has no matchMedia, so these run the wide-screen popover; one test
 * stubs a phone-width query to check the bottom sheet.
 */

const TOWNS = ['Gobabis', 'Keetmanshoop', 'Lüderitz', 'Okahandja', 'Oshakati', 'Otjiwarongo', 'Rundu', 'Swakopmund', 'Walvis Bay', 'Windhoek'];

// Controlled wrapper, the way every call site uses these.
function Controlled({ Comp, initial = '', onChange, ...rest }) {
    const [value, setValue] = useState(initial);
    return (
        <Comp
            value={value}
            onChange={(e) => { onChange?.(e); setValue(e.target.value); }}
            {...rest}
        />
    );
}

describe('Select', () => {
    const options = [
        { value: 'fixed', label: 'Fixed price' },
        { value: 'free', label: 'Free' },
        { value: 'quote', label: 'On quote', disabled: true },
    ];

    it('picks an option with the mouse and reports a native-shaped event', async () => {
        const onChange = vi.fn();
        render(<Controlled Comp={Select} initial="fixed" options={options} onChange={onChange} name="priceType" aria-label="Price type" data-testid="price" />);

        const trigger = screen.getByTestId('price');
        expect(trigger).toHaveTextContent('Fixed price');
        await userEvent.click(trigger);
        await userEvent.click(screen.getByRole('option', { name: 'Free' }));

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0].target).toEqual({ value: 'free', name: 'priceType' });
        expect(trigger).toHaveTextContent('Free');
        expect(trigger).toHaveAttribute('data-value', 'free');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('is fully keyboard driven: arrows skip disabled rows, Enter commits, focus returns', async () => {
        const onChange = vi.fn();
        render(<Controlled Comp={Select} initial="" placeholder="Pick one" options={options} onChange={onChange} aria-label="Price type" />);

        const trigger = screen.getByRole('combobox', { name: 'Price type' });
        expect(trigger).toHaveTextContent('Pick one');
        trigger.focus();
        await userEvent.keyboard('{ArrowDown}');
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        // Opens on the first row; End lands on the last ENABLED row.
        await userEvent.keyboard('{End}');
        const active = trigger.getAttribute('aria-activedescendant');
        expect(document.getElementById(active)).toHaveTextContent('Free');
        await userEvent.keyboard('{Enter}');

        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: { value: 'free', name: '' } }));
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveFocus();
    });

    it('closes on Escape without changing the value, and the Escape stops there', async () => {
        const onChange = vi.fn();
        // Stand-in for an app modal that closes itself on a document-level Escape.
        const modalEscape = vi.fn();
        function InModal() {
            useEffect(() => {
                const onKey = (e) => { if (e.key === 'Escape') modalEscape(); };
                document.addEventListener('keydown', onKey);
                return () => document.removeEventListener('keydown', onKey);
            }, []);
            return <Controlled Comp={Select} initial="fixed" options={options} onChange={onChange} aria-label="Price type" />;
        }
        render(<InModal />);

        const trigger = screen.getByRole('combobox', { name: 'Price type' });
        await userEvent.click(trigger);
        await userEvent.keyboard('{ArrowDown}{Escape}');

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
        expect(modalEscape).not.toHaveBeenCalled();
        expect(trigger).toHaveFocus();
    });

    it('jumps by typeahead like a native select', async () => {
        const onChange = vi.fn();
        render(<Controlled Comp={Select} initial="" options={options} onChange={onChange} aria-label="Price type" />);

        screen.getByRole('combobox', { name: 'Price type' }).focus();
        await userEvent.keyboard('fr');
        await userEvent.keyboard('{Enter}');

        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: 'free' }) }));
    });

    it('turns on search above 8 options and filters accent-insensitively', async () => {
        const onChange = vi.fn();
        render(
            <Controlled
                Comp={Select}
                initial=""
                placeholder="Select a town…"
                options={TOWNS.map((t) => ({ value: t, label: t }))}
                onChange={onChange}
                aria-label="Town"
                data-testid="town"
            />,
        );

        await userEvent.click(screen.getByTestId('town'));
        const search = screen.getByTestId('town-search');
        expect(search).toHaveFocus();
        await userEvent.type(search, 'luder');
        const listbox = screen.getByRole('listbox');
        expect(within(listbox).getAllByRole('option')).toHaveLength(1);
        await userEvent.keyboard('{Enter}');

        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: 'Lüderitz' }) }));
    });

    it('takes the old <option>/<optgroup> children and runs action rows', async () => {
        const onChange = vi.fn();
        const onNew = vi.fn();
        render(
            <Controlled Comp={Select} initial="" onChange={onChange} aria-label="Category" actions={[{ label: '+ New category…', onSelect: onNew, 'data-testid': 'new-cat' }]}>
                <option value="">Featured (uncategorized)</option>
                <optgroup label="Hair">
                    <option value="c1">Cuts</option>
                    <option value="c2">Colour</option>
                </optgroup>
            </Controlled>,
        );

        const trigger = screen.getByRole('combobox', { name: 'Category' });
        expect(trigger).toHaveTextContent('Featured (uncategorized)');
        await userEvent.click(trigger);
        expect(screen.getByRole('group', { name: 'Hair' })).toBeInTheDocument();
        await userEvent.click(screen.getByTestId('new-cat'));

        expect(onNew).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();

        await userEvent.click(trigger);
        await userEvent.click(screen.getByRole('option', { name: 'Colour' }));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: 'c2' }) }));
    });

    it('opens as a bottom sheet on a phone-width screen', async () => {
        vi.stubGlobal('matchMedia', (query) => ({
            matches: query === '(max-width: 640px)',
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
        }));
        try {
            render(<Controlled Comp={Select} initial="fixed" options={options} aria-label="Price type" data-testid="price" />);
            await userEvent.click(screen.getByTestId('price'));
            const panel = screen.getByTestId('price-popup');
            expect(panel).toHaveClass('bp-sheet');
            expect(panel.querySelector('.bp-handle')).toBeTruthy();
            expect(within(panel).getByText('Price type')).toBeInTheDocument();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('DatePicker', () => {
    it('round-trips YYYY-MM-DD: shows the value, reports the picked day in the same format', async () => {
        const onChange = vi.fn();
        render(<Controlled Comp={DatePicker} initial="2026-03-10" onChange={onChange} name="date" aria-label="Date" data-testid="date" />);

        const trigger = screen.getByTestId('date');
        expect(trigger).toHaveTextContent('Tue, Mar 10, 2026');
        await userEvent.click(trigger);
        expect(screen.getByRole('gridcell', { name: /March 10, 2026/ })).toHaveAttribute('aria-selected', 'true');
        await userEvent.click(screen.getByRole('gridcell', { name: /March 15, 2026/ }));

        expect(onChange.mock.calls[0][0].target).toEqual({ value: '2026-03-15', name: 'date' });
        expect(trigger).toHaveAttribute('data-value', '2026-03-15');
        expect(trigger).toHaveTextContent('Sun, Mar 15, 2026');
    });

    it('moves by keyboard across the month boundary', async () => {
        const onChange = vi.fn();
        render(<Controlled Comp={DatePicker} initial="2026-01-31" onChange={onChange} aria-label="Date" data-testid="date" />);

        await userEvent.click(screen.getByTestId('date'));
        expect(screen.getByRole('gridcell', { name: /January 31, 2026/ })).toHaveFocus();
        await userEvent.keyboard('{ArrowRight}');
        expect(screen.getByRole('gridcell', { name: /February 1, 2026/ })).toHaveFocus();
        await userEvent.keyboard('{Enter}');

        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: '2026-02-01' }) }));
    });

    it('honours min/max and can be cleared', async () => {
        const onChange = vi.fn();
        render(<Controlled Comp={DatePicker} initial="2026-05-20" min="2026-05-10" max="2026-05-25" clearable onChange={onChange} aria-label="Date" data-testid="date" />);

        await userEvent.click(screen.getByTestId('date'));
        const before = screen.getByRole('gridcell', { name: /May 9, 2026/ });
        expect(before).toHaveAttribute('aria-disabled', 'true');
        await userEvent.click(before);
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();

        await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: '' }) }));
        expect(screen.getByTestId('date')).toHaveAttribute('data-value', '');
    });
});

describe('TimePicker', () => {
    it('shows and reports 24-hour HH:MM, never AM/PM', async () => {
        const onChange = vi.fn();
        render(<Controlled Comp={TimePicker} initial="17:30" onChange={onChange} aria-label="Start" data-testid="t" />);

        const trigger = screen.getByTestId('t');
        expect(trigger).toHaveTextContent('17:30');
        expect(trigger.textContent).not.toMatch(/AM|PM/i);

        await userEvent.click(trigger);
        const hours = screen.getByRole('listbox', { name: 'Hour' });
        expect(within(hours).getAllByRole('option')).toHaveLength(24);
        expect(within(hours).getByRole('option', { name: '23' })).toBeInTheDocument();
        await userEvent.click(within(hours).getByRole('option', { name: '21' }));
        await userEvent.click(within(screen.getByRole('listbox', { name: 'Minute' })).getByRole('option', { name: '45' }));

        expect(onChange.mock.calls.map((c) => c[0].target.value)).toEqual(['21:30', '21:45']);
        expect(trigger).toHaveTextContent('21:45');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('respects step, min and max', async () => {
        render(<Controlled Comp={TimePicker} initial="" step={30} min="08:00" max="18:00" aria-label="Start" data-testid="t" />);

        await userEvent.click(screen.getByTestId('t'));
        const minutes = within(screen.getByRole('listbox', { name: 'Minute' })).getAllByRole('option');
        expect(minutes.map((o) => o.textContent)).toEqual(['00', '30']);
        const hours = screen.getByRole('listbox', { name: 'Hour' });
        expect(within(hours).getByRole('option', { name: '07' })).toHaveAttribute('aria-disabled', 'true');
        expect(within(hours).getByRole('option', { name: '19' })).toHaveAttribute('aria-disabled', 'true');
        expect(within(hours).getByRole('option', { name: '12' })).not.toHaveAttribute('aria-disabled');
    });

    it('reads a native step in seconds, and accepts typed digits', async () => {
        const onChange = vi.fn();
        render(<Controlled Comp={TimePicker} initial="" step={900} onChange={onChange} aria-label="Start" data-testid="t" />);

        screen.getByTestId('t').focus();
        await userEvent.keyboard('0930');
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: '09:30' }) }));

        await userEvent.click(screen.getByTestId('t'));
        const minutes = within(screen.getByRole('listbox', { name: 'Minute' })).getAllByRole('option');
        expect(minutes.map((o) => o.textContent)).toEqual(['00', '15', '30', '45']);
    });
});

describe('Confirm', () => {
    function Asker({ onResult, options }) {
        const confirm = useConfirm();
        return <button type="button" onClick={async () => onResult(await confirm(options))}>Ask</button>;
    }

    it('resolves true when confirmed', async () => {
        const onResult = vi.fn();
        render(<ConfirmProvider><Asker onResult={onResult} options={{ title: 'Delete this service?', danger: true, confirmLabel: 'Delete' }} /></ConfirmProvider>);

        await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
        const dialog = screen.getByRole('alertdialog', { name: 'Delete this service?' });
        // Destructive: focus starts on the safe choice.
        expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('resolves false on Cancel and on Escape, and returns focus', async () => {
        const onResult = vi.fn();
        render(<ConfirmProvider><Asker onResult={onResult} options="Leave this waiting list?" /></ConfirmProvider>);
        const ask = screen.getByRole('button', { name: 'Ask' });

        await userEvent.click(ask);
        await userEvent.click(screen.getByTestId('confirm-cancel'));
        await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));

        await userEvent.click(ask);
        expect(screen.getByRole('alertdialog', { name: 'Leave this waiting list?' })).toBeInTheDocument();
        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
        expect(onResult).toHaveBeenLastCalledWith(false);
        expect(ask).toHaveFocus();
    });

    it('keeps multi-line messages and has an alert variant', async () => {
        const done = vi.fn();
        function Alerter() {
            const alert = useAlert();
            return <button type="button" onClick={async () => { await alert({ title: 'Heads up', message: 'Line one\n\nLine two' }); done(); }}>Tell</button>;
        }
        render(<ConfirmProvider><Alerter /></ConfirmProvider>);

        await userEvent.click(screen.getByRole('button', { name: 'Tell' }));
        const dialog = screen.getByRole('dialog', { name: 'Heads up' });
        expect(within(dialog).getByText(/Line one/).textContent).toBe('Line one\n\nLine two');
        expect(within(dialog).queryByTestId('confirm-cancel')).not.toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));

        await waitFor(() => expect(done).toHaveBeenCalled());
    });

    it('falls back to the native dialog outside a provider', async () => {
        const native = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const onResult = vi.fn();
        render(<Asker onResult={onResult} options={{ title: 'Sure?' }} />);

        await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

        await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
        expect(native).toHaveBeenCalledWith('Sure?');
    });
});

afterEach(() => {
    document.body.style.overflow = '';
});

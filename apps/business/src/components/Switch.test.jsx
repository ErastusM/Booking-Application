import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Switch from './Switch';

/**
 * This component shipped once completely inert — the decorative track was
 * painted over the real checkbox and swallowed every click, so "Bookable" and
 * "Calendar access" simply could not be toggled. It rendered correctly, it
 * compiled, and it did nothing.
 *
 * An honest caveat about what these tests can and cannot prove: jsdom has no
 * layout engine and does no hit-testing, so a click aimed at the switch always
 * reaches whichever element the test names — it can never reproduce one box
 * covering another. Reproducing that needs a real browser (the e2e suite).
 * What is checkable here is the property the fix turns on, so a future edit
 * that drops `pointer-events` fails a test instead of shipping a dead control.
 */
describe('Switch', () => {
    it('toggles on and reports the new value', async () => {
        const onChange = vi.fn();
        render(<Switch checked={false} onChange={onChange} label="Bookable" data-testid="s" />);

        await userEvent.click(screen.getByTestId('s'));

        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('reports false when switching off', async () => {
        const onChange = vi.fn();
        render(<Switch checked onChange={onChange} label="Bookable" data-testid="s" />);

        await userEvent.click(screen.getByTestId('s'));

        expect(onChange).toHaveBeenCalledWith(false);
    });

    // The regression. The track is drawn on top of the input; if it is allowed
    // to receive pointer events it intercepts every one of them.
    it('keeps the decorative track out of the way of pointers', () => {
        const { container } = render(<Switch checked={false} onChange={() => {}} label="Bookable" data-testid="s" />);

        const track = container.querySelector('[data-track]');
        expect(track).toBeTruthy();
        expect(track.style.pointerEvents).toBe('none');
        // ...and it is genuinely on top of the input, which is why that matters.
        expect(screen.getByTestId('s').style.position).toBe('absolute');
    });

    it('is a real checkbox, so the keyboard works', async () => {
        const onChange = vi.fn();
        render(<Switch checked={false} onChange={onChange} label="Bookable" data-testid="s" />);

        await userEvent.tab();
        expect(screen.getByTestId('s')).toHaveFocus();
        await userEvent.keyboard(' ');

        expect(onChange).toHaveBeenCalledWith(true);
    });

    // A busy switch must not fire again while its first change is still saving.
    it('ignores input while disabled', async () => {
        const onChange = vi.fn();
        render(<Switch checked={false} onChange={onChange} disabled label="Bookable" data-testid="s" />);

        await userEvent.click(screen.getByTestId('s'), { pointerEventsCheck: 0 });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('shows the caller\'s label', () => {
        render(<Switch checked onChange={() => {}} label="Everyone" data-testid="s" />);
        expect(screen.getByText('Everyone')).toBeInTheDocument();
    });
});

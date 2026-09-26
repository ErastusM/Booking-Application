import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field, Select } from '@bookplus/ui';
import RecurrenceFields from '../components/RecurrenceFields';

// WCAG 1.3.1 / 4.1.2: a label drawn above a control is not a label unless it is
// tied to it in code. These pin the shared Field helper and the toggles that
// the accessibility audit found unnamed.
describe('Field (@bookplus/ui)', () => {
    it('ties its <label> to the control with a generated id', () => {
        render(<Field label="Email address"><input type="email" /></Field>);
        const input = screen.getByLabelText('Email address');
        expect(input.tagName).toBe('INPUT');
        expect(input.id).toBeTruthy();
    });

    it('gives two copies of the same form different ids', () => {
        render(<><Field label="Phone"><input /></Field><Field label="Phone"><input /></Field></>);
        const [a, b] = screen.getAllByLabelText('Phone');
        expect(a.id).not.toBe(b.id);
    });

    it('keeps a control id that is already there', () => {
        render(<Field label="Notes"><textarea id="notes" /></Field>);
        expect(screen.getByLabelText('Notes').id).toBe('notes');
    });

    it('links hint and error text and marks the control invalid', () => {
        render(<Field label="Name" hint="As on your ID" error="Required"><input /></Field>);
        const input = screen.getByLabelText('Name');
        expect(input).toHaveAccessibleDescription('As on your ID Required');
        expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('names the app-styled Select trigger too', () => {
        render(<Field label="Category"><Select value="" onChange={() => {}} options={[{ value: 'a', label: 'A' }]} /></Field>);
        expect(screen.getByLabelText('Category').tagName).toBe('BUTTON');
    });
});

describe('RecurrenceFields "Repeat this appointment" toggle', () => {
    it('is a named switch that reports its state', async () => {
        const onChange = vi.fn();
        const { rerender } = render(<RecurrenceFields value={{ isRecurring: false }} onChange={onChange} />);
        const sw = screen.getByRole('switch', { name: 'Repeat this appointment' });
        expect(sw).toHaveAttribute('aria-checked', 'false');
        await userEvent.click(sw);
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ isRecurring: true }));
        rerender(<RecurrenceFields value={{ isRecurring: true }} onChange={onChange} />);
        expect(screen.getByRole('switch', { name: 'Repeat this appointment' })).toHaveAttribute('aria-checked', 'true');
    });
});

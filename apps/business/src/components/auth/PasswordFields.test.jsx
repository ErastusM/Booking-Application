import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PasswordFields, { PASSWORD_RULES, passwordMeetsRules } from './PasswordFields';

// The server's regex, copied from apps/api authController (reset/accept/register).
const SERVER_RE = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

const Harness = () => {
    const [pw, setPw] = useState('');
    const [cf, setCf] = useState('');
    return <form><PasswordFields password={pw} onPassword={setPw} confirm={cf} onConfirm={setCf} username="a@b.co" testIdPrefix="t" /></form>;
};

describe('password rules', () => {
    it.each([
        'Password1!', 'Abcdefg1?', 'ZZZZZZZ9#', 'aB3~~~~~~', 'Abcdefgh1', 'abcdefg1!', 'ABCDEFG!!', 'Ab1!', 'Abcdef1 x', 'Ab1!\nxxxx',
        'Pässwörd1!', 'Password1`', 'Password1~', 'Password1/',
    ])('client and server agree on %p', (pw) => {
        expect(passwordMeetsRules(pw)).toBe(SERVER_RE.test(pw));
        const allRules = PASSWORD_RULES.every((r) => r.test(pw));
        // The ticked list says "all done" exactly when the server would accept
        // (the one exception, a line break, cannot be typed into the field).
        if (!pw.includes('\n')) expect(allRules).toBe(SERVER_RE.test(pw));
    });
});

describe('<PasswordFields>', () => {
    it('shows every rule before typing and ticks them live', () => {
        render(<Harness />);
        const items = screen.getByTestId('t-rules').querySelectorAll('li');
        expect(items).toHaveLength(4);
        items.forEach((li) => expect(li.dataset.met).toBe('false'));
        fireEvent.change(screen.getByTestId('t-password'), { target: { value: 'Password1!' } });
        screen.getByTestId('t-rules').querySelectorAll('li').forEach((li) => expect(li.dataset.met).toBe('true'));
    });

    it('show/hide toggles both fields; autocomplete + 16px for phones', () => {
        render(<Harness />);
        const pw = screen.getByTestId('t-password');
        const cf = screen.getByTestId('t-confirm');
        expect(pw).toHaveAttribute('type', 'password');
        expect(pw).toHaveAttribute('autocomplete', 'new-password');
        expect(cf).toHaveAttribute('autocomplete', 'new-password');
        expect(pw.style.fontSize).toBe('16px');
        fireEvent.click(screen.getByTestId('t-toggle'));
        expect(pw).toHaveAttribute('type', 'text');
        expect(cf).toHaveAttribute('type', 'text');
        expect(document.querySelector('input[autocomplete="username"]').value).toBe('a@b.co');
    });

    it('says when the confirmation does not match', () => {
        render(<Harness />);
        fireEvent.change(screen.getByTestId('t-password'), { target: { value: 'Password1!' } });
        fireEvent.change(screen.getByTestId('t-confirm'), { target: { value: 'Password1' } });
        expect(screen.getByText(/don’t match/)).toBeInTheDocument();
        fireEvent.change(screen.getByTestId('t-confirm'), { target: { value: 'Password1!' } });
        expect(screen.getByText('Passwords match')).toBeInTheDocument();
    });
});

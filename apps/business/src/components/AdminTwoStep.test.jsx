import React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The admin console waits behind two-step sign-in: set it up, or confirm a
 * code for this session, before anything loads. A request the API refuses
 * later (the 12 hours ran out) brings the code screen back.
 */
const auth = vi.hoisted(() => ({ authService: {} }));
const ctx = vi.hoisted(() => ({ user: { _id: 'me', role: 'admin', email: 'boss@bookplus.pro' }, login: vi.fn() }));
vi.mock('../services', () => auth);
vi.mock('../context/AuthContext', () => ({ useAuthContext: () => ctx }));

import AdminTwoStepGate, { TWO_STEP_EVENT } from './AdminTwoStep';

const status = (s) => ({ data: { data: { recoveryCodesLeft: 8, ...s } } });
const Console = () => <p>The console</p>;

beforeEach(() => {
    ctx.login.mockReset();
    auth.authService = {
        mfaStatus: vi.fn(),
        mfaSetup: vi.fn().mockResolvedValue({ data: { data: { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', qrDataUrl: 'data:image/png;base64,AAA' } } }),
        mfaEnable: vi.fn().mockResolvedValue({ data: { data: { token: 'tok2', recoveryCodes: ['AAAAA-11111', 'BBBBB-22222'] } } }),
        mfaConfirm: vi.fn().mockResolvedValue({ data: { data: { token: 'tok3' } } }),
    };
});

describe('AdminTwoStepGate', () => {
    it('no two-step yet: the set-up, recovery codes, then the console', async () => {
        auth.authService.mfaStatus
            .mockResolvedValueOnce(status({ enabled: false, sessionConfirmed: false }))
            .mockResolvedValue(status({ enabled: true, sessionConfirmed: true }));
        render(<AdminTwoStepGate><Console /></AdminTwoStepGate>);
        expect(await screen.findByRole('heading', { name: 'Set up two-step sign-in' })).toBeInTheDocument();
        expect(screen.queryByText('The console')).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Start set-up' }));
        expect(await screen.findByRole('img', { name: /QR code/ })).toHaveAttribute('src', 'data:image/png;base64,AAA');
        // The secret is shown in groups of four so it can be typed.
        expect(screen.getByTestId('mfa-secret').querySelectorAll('span')).toHaveLength(8);
        await userEvent.type(await screen.findByLabelText('Enter the 6-digit code the app shows'), '123456');
        await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
        expect(await screen.findByTestId('mfa-recovery-codes')).toHaveTextContent('AAAAA-11111');
        expect(ctx.login).toHaveBeenCalledWith({ token: 'tok2', user: ctx.user });

        // A late refusal from an earlier request doesn't hide the codes.
        act(() => { window.dispatchEvent(new CustomEvent(TWO_STEP_EVENT)); });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(auth.authService.mfaStatus).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('mfa-recovery-codes')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'I saved them' }));
        expect(await screen.findByText('The console')).toBeInTheDocument();
    });

    it('two-step on but not confirmed this session: the code, then the console', async () => {
        auth.authService.mfaStatus
            .mockResolvedValueOnce(status({ enabled: true, sessionConfirmed: false }))
            .mockResolvedValue(status({ enabled: true, sessionConfirmed: true }));
        render(<AdminTwoStepGate><Console /></AdminTwoStepGate>);
        await userEvent.type(await screen.findByLabelText('Code'), '654321');
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
        expect(auth.authService.mfaConfirm).toHaveBeenCalledWith('654321');
        expect(ctx.login).toHaveBeenCalledWith({ token: 'tok3', user: ctx.user });
        expect(await screen.findByText('The console')).toBeInTheDocument();
    });

    it('a refusal later in the session asks for the code again', async () => {
        auth.authService.mfaStatus
            .mockResolvedValueOnce(status({ enabled: true, sessionConfirmed: true }))
            .mockResolvedValue(status({ enabled: true, sessionConfirmed: false }));
        render(<AdminTwoStepGate><Console /></AdminTwoStepGate>);
        expect(await screen.findByText('The console')).toBeInTheDocument();
        act(() => { window.dispatchEvent(new CustomEvent(TWO_STEP_EVENT)); });
        expect(await screen.findByRole('heading', { name: "Confirm it's you" })).toBeInTheDocument();
        expect(screen.queryByText('The console')).not.toBeInTheDocument();
    });
});

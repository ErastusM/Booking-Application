import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The admin console's Money tab: two-step sign-in first (set up, or confirm
 * this session), then prices and fees with the simulator and launch checklist.
 * Only a director edits; a change needs a reason and is sent as nested values.
 */
const auth = vi.hoisted(() => ({ authService: {}, financeService: {} }));
const ctx = vi.hoisted(() => ({ user: { _id: 'me', role: 'admin', email: 'boss@bookplus.pro' }, login: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('../services', () => auth);
vi.mock('../context/AuthContext', () => ({ useAuthContext: () => ctx }));
vi.mock('./Toast', () => ({ useToast: () => toast }));

import MoneyPanel from './MoneyPanel';

const SETTINGS = {
    version: 3,
    plans: {
        basic: { label: 'Basic', trialDays: 30, introMonths: 6, introPriceCents: 6999, priceCents: 14999, priceChangeNoticeDays: 14, commissionBps: 150, fixedFeeCents: 0 },
        standard: { label: 'Standard', priceCents: 0, commissionBps: 300, fixedFeeCents: 150 },
    },
    processingFee: { bps: null, fixedCents: null, payer: 'business' },
    chargebackFeeCents: null,
    minCommissionCents: 0, minOnlineBookingCents: 0, opsCostPerTxCents: 0,
    payout: { frequency: 'weekly', weekday: 5, minThresholdCents: 0 },
    vat: { registered: false, number: '', ratePct: 15 },
    approvals: { refundThresholdCents: 50000, adjustmentsNeedApproval: true },
};
const PAYLOAD = (roles = ['director']) => ({
    settings: SETTINGS,
    simulator: {
        processingFeeKnown: false, chargebackFeeKnown: false, anyNegative: true,
        rows: [
            { plan: 'basic', bookingCents: 5000, customerPaysCents: 5000, percentCommissionCents: 75, fixedFeeCents: 0, commissionCents: 75, processingFeeCents: 0, processingFeeKnown: false, businessPayoutCents: 4925, bookplusNetCents: -25, negativeMargin: true, belowMinimumBooking: false },
            { plan: 'standard', bookingCents: 20000, customerPaysCents: 20000, percentCommissionCents: 600, fixedFeeCents: 150, commissionCents: 750, processingFeeCents: 0, processingFeeKnown: false, businessPayoutCents: 19250, bookplusNetCents: 650, negativeMargin: false, belowMinimumBooking: false },
        ],
    },
    launch: { ready: false, items: [{ key: 'processingFeeEntered', done: false }, { key: 'providerApproved', done: false }] },
    me: { roles },
});

beforeEach(() => {
    toast.mockReset();
    ctx.login.mockReset();
    auth.authService = {
        mfaStatus: vi.fn().mockResolvedValue({ data: { data: { enabled: true, sessionConfirmed: true, recoveryCodesLeft: 8 } } }),
        mfaSetup: vi.fn().mockResolvedValue({ data: { data: { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', qrDataUrl: 'data:image/png;base64,AAA', otpauthUrl: 'otpauth://totp/x' } } }),
        mfaEnable: vi.fn().mockResolvedValue({ data: { data: { token: 'tok2', recoveryCodes: ['AAAAA-11111', 'BBBBB-22222'] } } }),
        mfaConfirm: vi.fn().mockResolvedValue({ data: { data: { token: 'tok3' } } }),
    };
    auth.financeService = {
        getSettings: vi.fn().mockResolvedValue({ data: { data: PAYLOAD() } }),
        updateSettings: vi.fn().mockResolvedValue({ data: { data: { ...PAYLOAD(), settings: { ...SETTINGS, version: 4 } } } }),
        setLaunchGate: vi.fn(),
    };
});

describe('MoneyPanel — two-step sign-in comes first', () => {
    it('sets it up: QR code and key, a code turns it on, recovery codes are shown once', async () => {
        auth.authService.mfaStatus.mockResolvedValueOnce({ data: { data: { enabled: false, sessionConfirmed: false } } });
        render(<MoneyPanel />);
        await userEvent.click(await screen.findByRole('button', { name: 'Start set-up' }));
        expect(await screen.findByAltText(/QR code/)).toHaveAttribute('src', 'data:image/png;base64,AAA');
        expect(screen.getByTestId('mfa-secret')).toHaveTextContent('JBSW Y3DP');
        await userEvent.type(screen.getByLabelText(/Enter the 6-digit code/), '123456');
        await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
        expect(auth.authService.mfaEnable).toHaveBeenCalledWith('123456');
        expect(ctx.login).toHaveBeenCalledWith({ token: 'tok2', user: ctx.user });
        const codes = await screen.findByTestId('mfa-recovery-codes');
        expect(within(codes).getByText('AAAAA-11111')).toBeInTheDocument();
        expect(auth.financeService.getSettings).not.toHaveBeenCalled();
    });

    it('asks for a code when this session is not confirmed, then shows the controls', async () => {
        auth.authService.mfaStatus.mockResolvedValueOnce({ data: { data: { enabled: true, sessionConfirmed: false } } });
        render(<MoneyPanel />);
        await userEvent.type(await screen.findByLabelText('Code'), '654321');
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
        expect(auth.authService.mfaConfirm).toHaveBeenCalledWith('654321');
        expect(ctx.login).toHaveBeenCalledWith({ token: 'tok3', user: ctx.user });
        expect(await screen.findByTestId('money-panel')).toBeInTheDocument();
    });
});

describe('MoneyPanel — prices and fees', () => {
    it('shows the simulator, flags a booking that loses money, and the launch checklist', async () => {
        render(<MoneyPanel />);
        await screen.findByTestId('money-panel');
        expect(screen.getByText('-N$0.25')).toBeInTheDocument();
        expect(screen.getAllByText('not entered').length).toBeGreaterThan(0);
        expect(screen.getByRole('alert')).toHaveTextContent(/loses money/);
        expect(within(screen.getByTestId('launch-providerApproved')).getByText('To do')).toBeInTheDocument();
    });

    it('a director saves a change with a reason, sent as nested values in cents and basis points', async () => {
        render(<MoneyPanel />);
        await screen.findByTestId('money-panel');
        const fee = screen.getByLabelText('Processing fee, percentage (%)');
        await userEvent.type(fee, '3.5');
        const save = screen.getByRole('button', { name: /Save 1 change/ });
        expect(save).toBeDisabled(); // no reason yet
        await userEvent.type(screen.getByLabelText(/Why are these changing/), 'PayGate quote');
        await userEvent.click(save);
        expect(auth.financeService.updateSettings).toHaveBeenCalledWith({ processingFee: { bps: 350 } }, 'PayGate quote');
        expect(toast).toHaveBeenCalledWith('Saved (version 4)', 'success');
    });

    it('finance (not a director) can read but not change them', async () => {
        auth.financeService.getSettings.mockResolvedValueOnce({ data: { data: PAYLOAD(['finance']) } });
        render(<MoneyPanel />);
        await screen.findByTestId('money-panel');
        expect(screen.getByText(/Only a director can change these/)).toBeInTheDocument();
        expect(screen.getByLabelText('Commission per online booking (%)', { selector: '#fin-plans\\.basic\\.commissionBps' })).toBeDisabled();
        expect(screen.queryByLabelText(/Why are these changing/)).not.toBeInTheDocument();
    });
});

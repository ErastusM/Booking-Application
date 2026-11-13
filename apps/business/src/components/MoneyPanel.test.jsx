import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The admin console's Money and Settings sections (two-step sign-in is the
 * console's gate, AdminTwoStep.test.jsx): the plan's prices and VAT, and the
 * launch checklist. Only a director edits; a change needs a reason and is sent
 * as nested values. (No booking payments, no commission.)
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
        basic: { label: 'Basic', trialDays: 30, introMonths: 6, introPriceCents: 6999, priceCents: 14999, priceChangeNoticeDays: 14 },
    },
    vat: { registered: false, number: '', ratePct: 15 },
};
const PAYLOAD = (roles = ['director']) => ({
    settings: SETTINGS,
    launch: { ready: false, items: [{ key: 'providerApproved', done: false }, { key: 'liveTestPassed', done: false }] },
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
        listAdmins: vi.fn().mockResolvedValue({ data: { data: [] } }),
        // The panel opens on Subscriptions (its own tests: SubscriptionsView.test.jsx).
        subscriptions: vi.fn(() => new Promise(() => {})),
    };
});

// Settings → Plan prices.
const openSettings = async (view = 'prices') => {
    render(<MoneyPanel view={view} />);
    await screen.findByTestId('money-panel');
};

describe('MoneyPanel — sections', () => {
    it('opens on Subscriptions, with no tab row of its own (the sidebar moves between sections)', async () => {
        render(<MoneyPanel />);
        await screen.findByTestId('money-panel');
        expect(auth.financeService.subscriptions).toHaveBeenCalled();
        expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    });

    it('an expired two-step session asks the console for the code again', async () => {
        const heard = vi.fn();
        window.addEventListener('admin-two-step-required', heard);
        auth.financeService.getSettings.mockRejectedValueOnce({ response: { data: { code: 'mfa_required' } } });
        render(<MoneyPanel view="prices" />);
        await vi.waitFor(() => expect(heard).toHaveBeenCalled());
        window.removeEventListener('admin-two-step-required', heard);
    });

    it('an admin without a money role is told so', async () => {
        auth.financeService.getSettings.mockRejectedValueOnce({ response: { data: { code: 'finance_role_required' } } });
        render(<MoneyPanel view="prices" />);
        expect(await screen.findByRole('alert')).toHaveTextContent(/needs a money role/);
    });
});

describe('MoneyPanel — plan prices', () => {
    it('shows the plan\'s prices and VAT only: no commission, fees, payouts or simulator', async () => {
        await openSettings();
        expect(screen.getByLabelText('Price a month after that (N$)')).toHaveValue('149.99');
        expect(screen.getByLabelText('Introductory price a month (N$)')).toHaveValue('69.99');
        expect(screen.getByLabelText('VAT rate (%)')).toBeInTheDocument();
        expect(screen.queryByText(/Commission/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Simulator/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Payouts/)).not.toBeInTheDocument();
    });

    it('the go-live checklist shows what is left, with the PayGate check', async () => {
        await openSettings('go-live');
        expect(screen.getByRole('heading', { name: 'Before businesses pay for their plan' })).toBeInTheDocument();
        expect(within(screen.getByTestId('launch-providerApproved')).getByText('To do')).toBeInTheDocument();
        expect(screen.getByTestId('launch-liveTestPassed')).toHaveTextContent('A live first payment and monthly charge went through');
        expect(screen.getByTestId('paygate-check')).toBeInTheDocument();
    });

    it('a director saves a change with a reason, sent as nested values in cents', async () => {
        await openSettings();
        const price = screen.getByLabelText('Price a month after that (N$)');
        await userEvent.clear(price);
        await userEvent.type(price, '159.99');
        const save = screen.getByRole('button', { name: /Save 1 change/ });
        expect(save).toBeDisabled(); // no reason yet
        await userEvent.type(screen.getByLabelText(/Why are these changing/), 'New price list');
        await userEvent.click(save);
        expect(auth.financeService.updateSettings).toHaveBeenCalledWith({ plans: { basic: { priceCents: 15999 } } }, 'New price list');
        expect(toast).toHaveBeenCalledWith('Saved (version 4)', 'success');
    });

    it('finance (not a director) can read but not change them', async () => {
        auth.financeService.getSettings.mockResolvedValueOnce({ data: { data: PAYLOAD(['finance']) } });
        await openSettings();
        expect(screen.getByText(/Only a director can change these/)).toBeInTheDocument();
        expect(screen.getByLabelText('Price a month after that (N$)')).toBeDisabled();
        expect(screen.queryByLabelText(/Why are these changing/)).not.toBeInTheDocument();
    });
});

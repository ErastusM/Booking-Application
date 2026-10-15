import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The admin console's Money and Settings sections (two-step sign-in is the
 * console's gate, AdminTwoStep.test.jsx): prices and fees with the simulator,
 * the launch checklist, and business applications. Only a director edits; a
 * change needs a reason and is sent as nested values.
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
        listRequests: vi.fn().mockResolvedValue({ data: { data: [] } }),
        listApprovals: vi.fn().mockResolvedValue({ data: { data: [{ _id: 'b1', businessName: 'Vibe Cuts', name: 'Ndapewa', status: 'submitted', plan: 'standard', submittedAt: '2026-10-14T10:00:00Z' }] } }),
        getApproval: vi.fn().mockResolvedValue({ data: { data: APPLICATION() } }),
        getApprovalDocument: vi.fn().mockResolvedValue({ data: { data: { url: 'https://api.cloudinary.com/v1_1/x/image/download?sig', expiresInSeconds: 300 } } }),
        decideApproval: vi.fn().mockResolvedValue({ data: { data: {} } }),
        listAdmins: vi.fn().mockResolvedValue({ data: { data: [] } }),
        // The panel opens on the dashboard (its own tests: FinanceDashboard.test.jsx).
        dashboard: vi.fn(() => new Promise(() => {})),
    };
});

// Settings → Prices and fees (with the simulator).
const openSettings = async (view = 'prices') => {
    render(<MoneyPanel view={view} />);
    await screen.findByTestId('money-panel');
};

const APPLICATION = (over = {}) => ({
    _id: 'b1', businessName: 'Vibe Cuts', name: 'Ndapewa Shilongo', email: 'nd@vibe.na', phone: '+264811234567', address: 'Windhoek',
    status: 'submitted', takingPayments: false, adminOff: false, payoutAccountReviewNeeded: false, missing: [],
    payoutAccount: { hasAccount: true, accountHolder: 'Vibe Cuts CC', bankName: 'Bank Windhoek', branchCode: '483872', accountNumber: '80041234821' },
    application: {
        plan: 'standard', status: 'submitted',
        legal: { businessType: 'cc', registeredName: 'Vibe Cuts CC', registrationNumber: 'CC/2021/01234', ownerName: 'Ndapewa Shilongo', ownerIdNumber: '85010100123' },
        documents: [{ _id: 'd1', kind: 'bank_letter', name: 'bank.pdf' }],
        history: [{ status: 'submitted', at: '2026-10-14T10:00:00Z', note: '' }],
    },
    ...over,
});

describe('MoneyPanel — sections', () => {
    it('opens on the dashboard, with no tab row of its own (the sidebar moves between sections)', async () => {
        render(<MoneyPanel />);
        await screen.findByTestId('money-panel');
        expect(auth.financeService.dashboard).toHaveBeenCalled();
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

describe('MoneyPanel — prices and fees', () => {
    it('shows the simulator and flags a booking that loses money', async () => {
        await openSettings();
        expect(screen.getByText('-N$0.25')).toBeInTheDocument();
        expect(screen.getAllByText('not entered').length).toBeGreaterThan(0);
        expect(screen.getByRole('alert')).toHaveTextContent(/loses money/);
    });

    it('the go-live checklist shows what is left, with the PayGate check', async () => {
        await openSettings('go-live');
        expect(within(screen.getByTestId('launch-providerApproved')).getByText('To do')).toBeInTheDocument();
        expect(screen.getByTestId('paygate-check')).toBeInTheDocument();
    });

    it('a director saves a change with a reason, sent as nested values in cents and basis points', async () => {
        await openSettings();
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
        await openSettings();
        expect(screen.getByText(/Only a director can change these/)).toBeInTheDocument();
        expect(screen.getByLabelText('Commission per online booking (%)', { selector: '#fin-plans\\.basic\\.commissionBps' })).toBeDisabled();
        expect(screen.queryByLabelText(/Why are these changing/)).not.toBeInTheDocument();
    });
});

describe('MoneyPanel — businesses applying for online payments', () => {
    const openReview = async () => {
        render(<MoneyPanel view="approvals" />);
        await screen.findByTestId('money-panel');
        const row = await screen.findByTestId('approval-row');
        expect(row).toHaveTextContent('Vibe Cuts');
        expect(row).toHaveTextContent('Waiting for review, standard');
        await userEvent.click(within(row).getByRole('button', { name: 'Review' }));
        return screen.findByTestId('application-review');
    };

    it('shows the full details a reviewer checks: ID number and the whole account number', async () => {
        const review = await openReview();
        expect(review).toHaveTextContent('85010100123');
        expect(review).toHaveTextContent('80041234821');
        expect(review).toHaveTextContent('CC/2021/01234');
        expect(auth.financeService.getApproval).toHaveBeenCalledWith('b1');
    });

    it('opens a document in a new tab through a short-lived link', async () => {
        const tab = { opener: 'x', location: { href: '' }, close: vi.fn() };
        const open = vi.spyOn(window, 'open').mockReturnValue(tab);
        const review = await openReview();
        await userEvent.click(within(review).getByRole('button', { name: 'Open' }));
        expect(open).toHaveBeenCalledWith('about:blank', '_blank');
        expect(tab.opener).toBeNull();
        expect(auth.financeService.getApprovalDocument).toHaveBeenCalledWith('b1', 'd1');
        await vi.waitFor(() => expect(tab.location.href).toMatch(/^https:\/\/api\.cloudinary\.com\//));
        open.mockRestore();
    });

    it('approves; asking for more and rejecting need a note, and rejecting warns the documents go', async () => {
        const review = await openReview();
        await userEvent.click(within(review).getByRole('button', { name: 'Reject' }));
        expect(review).toHaveTextContent('Rejecting deletes the documents the business sent');
        const go = within(review).getAllByRole('button', { name: 'Reject' }).at(-1);
        expect(go).toBeDisabled();
        await userEvent.type(within(review).getByLabelText(/Why it is rejected/), 'ID does not match');
        await userEvent.click(go);
        expect(auth.financeService.decideApproval).toHaveBeenCalledWith('b1', 'reject', 'ID does not match');
    });

    it('cannot approve an application with something missing', async () => {
        auth.financeService.getApproval.mockResolvedValueOnce({ data: { data: APPLICATION({ missing: ['doc_bank_letter'] }) } });
        const review = await openReview();
        expect(review).toHaveTextContent('Missing: bank letter');
        expect(within(review).getByRole('button', { name: 'Approve' })).toBeDisabled();
    });

    it('approve sends the decision', async () => {
        const review = await openReview();
        await userEvent.click(within(review).getByRole('button', { name: 'Approve' }));
        expect(auth.financeService.decideApproval).toHaveBeenCalledWith('b1', 'approve');
        expect(toast).toHaveBeenCalledWith('Approved', 'success');
    });
});

describe('MoneyPanel — audit log', () => {
    it('labels a role change, with the account, old → new role and who did it', async () => {
        auth.financeService.getAudit = vi.fn().mockResolvedValue({ data: { data: [{
            _id: 'a1', action: 'security.role_change', reference: 'vido@barber.test', reason: 'provider → admin',
            actor: { name: 'Boss Admin', email: 'boss@bookplus.pro' }, actorRole: 'director', amountCents: null,
            approvalStatus: 'not_required', createdAt: '2026-10-15T09:00:00Z',
        }], next: null } });
        await openSettings('audit');
        const row = await screen.findByTestId('audit-row');
        expect(row).toHaveTextContent('Changed an account\'s role (vido@barber.test)');
        expect(row).toHaveTextContent('provider → admin');
        expect(row).toHaveTextContent('Boss Admin (director)');
        expect(row).not.toHaveTextContent('security.role_change');
    });
});

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Admin console, Money → Payments, Payouts and Disputes: payments that need a
 * look (ask PayGate, refund, open a case), the payout run (due, prepare, bank
 * file, paid or returned), and cases (lost chargeback recovered, complaint
 * refunded, notes, evidence).
 */
const svc = vi.hoisted(() => ({ financeService: {} }));
const toast = vi.hoisted(() => vi.fn());
const upload = vi.hoisted(() => vi.fn());
vi.mock('../services', () => svc);
vi.mock('./Toast', () => ({ useToast: () => toast }));
vi.mock('../utils/uploadImage', () => ({ uploadDisputeEvidence: upload, VERIFICATION_ACCEPT: '.pdf' }));

import { PaymentsView, PayoutsView, DisputesView } from './MoneyOperations';

const ok = (data, extra = {}) => Promise.resolve({ status: 200, data: { success: true, data, ...extra } });
const payment = (over = {}) => ({
    _id: 'p1', reference: 'BP0123456789ABCDEF0123456789AB', status: 'initiated', kind: 'full', amountCents: 20000, refundedCents: 0, refundableCents: 0,
    refunds: [], flagged: false, refundRequest: null,
    provider: { _id: 'b1', businessName: 'Vibe Cuts' },
    appointment: { _id: 'a1', clientName: 'Ana Shilongo', service: 'Taper Fade', appointmentDate: '2026-11-01T00:00:00Z', startTime: '10:00' },
    ...over,
});
const DISPUTE = {
    _id: 'd1', kind: 'chargeback', status: 'open', amountCents: 20000, feeCents: 15000, caseReference: 'CB-1', deadlineAt: null,
    summary: 'Client says they were never there', provider: { _id: 'b1', businessName: 'Vibe Cuts' }, notes: [], evidence: [], requests: [],
    payment: payment({ status: 'paid' }), uploadsAvailable: true, outcomeNote: '',
};

beforeEach(() => {
    toast.mockReset();
    upload.mockReset();
    svc.financeService = {
        payments: vi.fn(() => ok([payment()], { pages: 1 })),
        syncPayment: vi.fn(() => ok(payment({ status: 'paid', refundableCents: 20000 }), { message: 'Updated: initiated → paid.' })),
        prepareRefund: vi.fn(() => Promise.resolve({ status: 202, data: { success: true, code: 'approval_required', message: 'Above the approval limit: a director must approve it.' } })),
        retryRefund: vi.fn(() => ok(payment())),
        openDispute: vi.fn(() => Promise.resolve({ status: 201, data: { success: true, data: { _id: 'd9' } } })),
        payoutsDue: vi.fn(() => Promise.resolve({ data: {
            schedule: { frequency: 'weekly', weekday: 5, weekdayName: 'Friday', minThresholdCents: 10000, nextRunDate: '2026-10-16T00:00:00Z' },
            data: [
                { providerId: 'b1', businessName: 'Vibe Cuts', amountCents: 38500, payable: true, bankName: 'Bank Windhoek', accountNumberMasked: '•••• 4821' },
                { providerId: 'b2', businessName: 'No Account', amountCents: 19250, payable: false, blockedBy: 'payout_account_missing' },
            ],
        } })),
        payouts: vi.fn(({ status } = {}) => ok(status === 'pending'
            ? [{ _id: 'po1', status: 'pending', amountCents: 38500, ourReference: 'BPP0123456789', bankName: 'Bank Windhoek', accountNumberMasked: '•••• 4821', provider: { businessName: 'Vibe Cuts' } }]
            : [{ _id: 'po0', status: 'failed', amountCents: 5000, failureReason: 'Account closed', provider: { businessName: 'Glow Nails' } }])),
        preparePayouts: vi.fn(() => Promise.resolve({ status: 201, data: { success: true, message: '1 payout prepared (N$385.00).' } })),
        payoutPaid: vi.fn(() => ok({}, { message: 'Marked paid' })),
        payoutFailed: vi.fn(() => ok({}, { message: 'Marked as returned' })),
        payoutBankFile: vi.fn(() => Promise.resolve({ data: new Blob(['x'], { type: 'text/csv' }) })),
        disputes: vi.fn(() => ok([DISPUTE])),
        getDispute: vi.fn(() => ok(DISPUTE)),
        addDisputeNote: vi.fn(() => ok({})),
        addDisputeEvidence: vi.fn(() => ok({})),
        getDisputeEvidence: vi.fn(() => ok({ url: 'https://api.cloudinary.com/x' })),
        refundFromDispute: vi.fn(() => ok({}, { message: 'Refund sent' })),
        closeDispute: vi.fn(() => ok({}, { message: 'Closed. Recovering it from the business waits for a director.' })),
    };
});

describe('PaymentsView', () => {
    it('opens on what needs a look; "Ask PayGate" updates the payment in place', async () => {
        const user = userEvent.setup();
        render(<PaymentsView onLocked={vi.fn()} onCaseOpened={vi.fn()} />);
        const card = await screen.findByTestId('ops-payment');
        expect(svc.financeService.payments).toHaveBeenCalledWith(expect.objectContaining({ view: 'attention' }));
        expect(card).toHaveTextContent('Vibe Cuts');
        expect(card).toHaveTextContent('Ana Shilongo · Taper Fade');
        await user.click(within(card).getByRole('button', { name: 'Ask PayGate' }));
        expect(svc.financeService.syncPayment).toHaveBeenCalledWith('p1');
        await waitFor(() => expect(within(screen.getByTestId('ops-payment')).getByTestId('ops-payment-status')).toHaveTextContent('Paid'));
        expect(toast).toHaveBeenCalledWith('Updated: initiated → paid.', 'success', 6000);
    });

    it('prepares a refund with a reason, and opens a case from a paid payment', async () => {
        const user = userEvent.setup();
        const onCaseOpened = vi.fn();
        svc.financeService.payments = vi.fn(() => ok([payment({ status: 'paid', refundableCents: 20000 })], { pages: 1 }));
        render(<PaymentsView onLocked={vi.fn()} onCaseOpened={onCaseOpened} />);
        const card = await screen.findByTestId('ops-payment');
        await user.click(within(card).getByRole('button', { name: 'Refund' }));
        await user.type(within(card).getByLabelText(/Amount/), '50');
        await user.type(within(card).getByLabelText('Why'), 'Started late');
        await user.click(within(card).getByRole('button', { name: 'Prepare the refund' }));
        expect(svc.financeService.prepareRefund).toHaveBeenCalledWith('p1', { amountCents: 5000, reason: 'Started late' });
        expect(toast).toHaveBeenCalledWith('Above the approval limit: a director must approve it.', 'info', 6000);

        await user.click(within(screen.getByTestId('ops-payment')).getByRole('button', { name: 'Open a case' }));
        const c2 = screen.getByTestId('ops-payment');
        await user.selectOptions(within(c2).getByLabelText('What happened'), 'chargeback');
        await user.type(within(c2).getByLabelText('What it is about'), 'Bank letter CB-1');
        await user.click(within(c2).getByRole('button', { name: 'Open the case' }));
        expect(svc.financeService.openDispute).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'p1', kind: 'chargeback', summary: 'Bank letter CB-1' }));
        await waitFor(() => expect(onCaseOpened).toHaveBeenCalledWith('d9'));
    });

    it('an expired two-step session hands back to the code screen', async () => {
        const onLocked = vi.fn();
        svc.financeService.payments = vi.fn(() => Promise.reject({ response: { data: { code: 'mfa_required' } } }));
        render(<PaymentsView onLocked={onLocked} onCaseOpened={vi.fn()} />);
        await waitFor(() => expect(onLocked).toHaveBeenCalled());
    });
});

describe('PayoutsView', () => {
    it('shows who is due and why some cannot be paid, and prepares the chosen payouts', async () => {
        const user = userEvent.setup();
        render(<PayoutsView onLocked={vi.fn()} />);
        const due = await screen.findByTestId('ops-payouts-due');
        expect(screen.getByTestId('ops-payouts')).toHaveTextContent('Payouts every Friday (next: 16 Oct 2026), to businesses owed at least N$100.00.');
        expect(within(due).getByLabelText('Pay Vibe Cuts')).toBeChecked();
        expect(within(due).getByLabelText('Pay No Account')).toBeDisabled();
        expect(due).toHaveTextContent('No bank account added');
        await user.click(within(due).getByRole('button', { name: 'Prepare 1 payout (N$385.00)' }));
        expect(svc.financeService.preparePayouts).toHaveBeenCalledWith(['b1']);
        expect(screen.getByTestId('ops-payouts')).toHaveTextContent('Returned: Account closed');
    });

    it('marks a payout paid with the bank reference, or returned, and downloads the bank file', async () => {
        const user = userEvent.setup();
        const createObjectURL = vi.fn(() => 'blob:x');
        Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        render(<PayoutsView onLocked={vi.fn()} />);
        const po = await screen.findByTestId('ops-payout');
        expect(po).toHaveTextContent('ref BPP0123456789');
        await user.click(within(po).getByRole('button', { name: 'Paid' }));
        await user.type(within(po).getByLabelText(/bank's reference/), 'BW-77812');
        await user.click(within(po).getByRole('button', { name: 'Mark paid' }));
        expect(svc.financeService.payoutPaid).toHaveBeenCalledWith('po1', 'BW-77812');

        const po2 = await screen.findByTestId('ops-payout');
        await user.click(within(po2).getByRole('button', { name: 'Returned by the bank' }));
        await user.type(within(po2).getByLabelText('What the bank said'), 'Account closed');
        await user.click(within(po2).getByRole('button', { name: 'Put it back on their balance' }));
        expect(svc.financeService.payoutFailed).toHaveBeenCalledWith('po1', 'Account closed');

        await user.click(screen.getByRole('button', { name: 'Download bank file (CSV)' }));
        expect(svc.financeService.payoutBankFile).toHaveBeenCalled();
        expect(click).toHaveBeenCalled();
        click.mockRestore();
    });
});

describe('DisputesView', () => {
    it('a lost chargeback is recorded and its recovery sent to a director', async () => {
        const user = userEvent.setup();
        render(<DisputesView onLocked={vi.fn()} />);
        await user.click(await screen.findByTestId('ops-dispute-row'));
        const d = await screen.findByTestId('ops-dispute');
        expect(d).toHaveTextContent('Card chargeback: Vibe Cuts');
        expect(d).toHaveTextContent("Card processor's feeN$150.00");
        await user.click(within(d).getByRole('button', { name: 'Lost' }));
        expect(within(d).getByRole('checkbox')).toBeChecked();
        expect(d).toHaveTextContent('Recover N$350.00 (the amount and the fee)');
        await user.type(within(d).getByLabelText('How it ended'), 'Bank sided with the client');
        await user.click(within(d).getByRole('button', { name: 'Record: lost' }));
        expect(svc.financeService.closeDispute).toHaveBeenCalledWith('d1', { outcome: 'lost', note: 'Bank sided with the client', recover: {} });
    });

    it('a complaint: refund the client; notes and evidence', async () => {
        const user = userEvent.setup();
        svc.financeService.getDispute = vi.fn(() => ok({
            ...DISPUTE, kind: 'service_not_provided', feeCents: 0, amountCents: 10000,
            evidence: [{ _id: 'e1', name: 'chat.pdf', by: 'Finance Fiona', at: '2026-10-10T00:00:00Z' }],
        }));
        const tab = { opener: 'x', location: { href: '' }, close: vi.fn() };
        vi.spyOn(window, 'open').mockReturnValue(tab);
        upload.mockResolvedValue({ ref: { publicId: 'bookplus/disputes/d1/x', resourceType: 'image', format: 'pdf' } });
        render(<DisputesView onLocked={vi.fn()} openId="d1" />);
        const d = await screen.findByTestId('ops-dispute');
        expect(within(d).queryByRole('button', { name: 'Lost' })).toBeNull();
        await user.click(within(d).getByRole('button', { name: 'Refund the client' }));
        await user.type(within(d).getByLabelText('Why'), 'Business was closed');
        await user.click(within(d).getByRole('button', { name: 'Prepare the refund' }));
        expect(svc.financeService.refundFromDispute).toHaveBeenCalledWith('d1', { amountCents: 10000, reason: 'Business was closed' });

        await user.type(screen.getByLabelText('New note'), 'Called the business');
        await user.click(screen.getByRole('button', { name: 'Add' }));
        expect(svc.financeService.addDisputeNote).toHaveBeenCalledWith('d1', 'Called the business');

        await user.click(screen.getByRole('button', { name: 'Open' }));
        await waitFor(() => expect(tab.location.href).toBe('https://api.cloudinary.com/x'));
        expect(tab.opener).toBeNull();

        const file = new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' });
        await user.upload(screen.getByLabelText('Add a file', { selector: 'input' }), file);
        await waitFor(() => expect(svc.financeService.addDisputeEvidence).toHaveBeenCalledWith('d1', { name: 'receipt.pdf', ref: expect.objectContaining({ publicId: 'bookplus/disputes/d1/x' }) }));
    });
});

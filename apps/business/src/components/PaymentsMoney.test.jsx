import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Account → Online payments, once approved: the balance and payout schedule,
 * bookings paid online with their fees, refunds (straight away, or sent to
 * Bookplus to approve), a refund PayGate did not take, and the statement.
 */
const svc = vi.hoisted(() => ({ onlinePaymentsService: {} }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('../services', () => svc);
vi.mock('./Toast', () => ({ useToast: () => toast }));

import PaymentsMoney from './PaymentsMoney';

const BALANCE = {
    currency: 'NAD', balanceOwedCents: 37300, paidOnlineThisMonthCents: 40000, paidOutThisMonthCents: 0, refundsPendingCents: 0,
    lastPayout: { amountCents: 12000, paidAt: '2026-10-09T10:00:00Z', reference: 'BW-1' },
    payoutSchedule: { frequency: 'weekly', weekday: 5, minThresholdCents: 10000 },
};
const payment = (over = {}) => ({
    _id: 'p1', reference: 'BP1', status: 'paid', kind: 'deposit', amountCents: 5000, refundedCents: 0, refundingCents: 0, refundableCents: 5000,
    fees: { plan: 'standard', commissionBps: 300, commissionCents: 300, fixedFeeCents: 150, processingFeeCents: 175, processingFeePayer: 'business', businessShareCents: 4525 },
    refunds: [], refundRequest: null,
    appointment: { _id: 'a1', status: 'confirmed', appointmentDate: '2026-11-01T00:00:00Z', startTime: '09:00', service: 'Haircut', clientName: 'Thandi' },
    ...over,
});
const page = (data, pages = 1) => Promise.resolve({ data: { data, pages } });

beforeEach(() => {
    toast.mockReset();
    svc.onlinePaymentsService = {
        balance: vi.fn(() => Promise.resolve({ data: { data: BALANCE } })),
        payments: vi.fn(() => page([payment()])),
        ledger: vi.fn(() => page([
            { _id: 'l2', date: '2026-10-10T09:00:00Z', type: 'commission', description: 'Bookplus commission: Thandi — Haircut', amountCents: -300, balanceAfterCents: 37300 },
            { _id: 'l1', date: '2026-10-10T09:00:00Z', type: 'payment', description: 'Online payment: Thandi — Haircut', amountCents: 5000, balanceAfterCents: 37600 },
        ])),
        refund: vi.fn(() => Promise.resolve({ data: { success: true, message: 'Refund sent' } })),
        retryRefund: vi.fn(() => Promise.resolve({ data: { success: true, message: 'Refund sent' } })),
        statementCsv: vi.fn(() => Promise.resolve({ data: new Blob(['Date,Type\r\n'], { type: 'text/csv' }) })),
    };
});

describe('PaymentsMoney', () => {
    it('shows what Bookplus owes, this month, the last payout and when Bookplus pays out', async () => {
        render(<PaymentsMoney />);
        const b = await screen.findByTestId('money-balance');
        expect(b).toHaveTextContent('Bookplus owes you');
        expect(screen.getByTestId('money-owed')).toHaveTextContent('N$373.00');
        expect(b).toHaveTextContent('Paid online this month');
        expect(b).toHaveTextContent('N$120.00, 9 Oct 2026');
        expect(b).toHaveTextContent('Bookplus pays into your bank account every Friday, once you are owed N$100.00 or more.');
        // Only settled payments are listed.
        expect(svc.onlinePaymentsService.payments).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid,refund_pending,partially_refunded,refunded' }));
    });

    it('a negative balance says the business owes Bookplus', async () => {
        svc.onlinePaymentsService.balance = vi.fn(() => Promise.resolve({ data: { data: { ...BALANCE, balanceOwedCents: -600 } } }));
        render(<PaymentsMoney />);
        expect(await screen.findByTestId('money-balance')).toHaveTextContent('You owe Bookplus');
        expect(screen.getByTestId('money-owed')).toHaveTextContent('N$6.00');
    });

    it('each paid booking shows its state and, on request, what Bookplus kept and what the business gets', async () => {
        const user = userEvent.setup();
        render(<PaymentsMoney />);
        const row = await screen.findByTestId('money-payment');
        expect(row).toHaveTextContent('Thandi · Haircut');
        expect(within(row).getByTestId('money-payment-status')).toHaveTextContent('Deposit paid');
        await user.click(within(row).getByRole('button', { name: 'Fees' }));
        expect(row).toHaveTextContent('Bookplus commission (3% + fixed fee)−N$3.00');
        expect(row).toHaveTextContent('Card processing fee−N$1.75');
        expect(row).toHaveTextContent('You getN$45.25');
    });

    it('refunds part of a payment with a reason, then reloads', async () => {
        const user = userEvent.setup();
        render(<PaymentsMoney />);
        const row = await screen.findByTestId('money-payment');
        await user.click(within(row).getByRole('button', { name: 'Refund' }));
        const dlg = screen.getByTestId('refund-dialog');
        const amount = within(dlg).getByLabelText(/Amount/);
        expect(amount).toHaveValue('50.00');
        await user.clear(amount);
        await user.type(amount, '20');
        await user.click(within(dlg).getByRole('button', { name: 'Refund N$20.00' }));
        expect(within(dlg).getByRole('alert')).toHaveTextContent('Say why');
        expect(svc.onlinePaymentsService.refund).not.toHaveBeenCalled();
        await user.type(within(dlg).getByLabelText('Why'), 'Started late');
        await user.click(within(dlg).getByRole('button', { name: 'Refund N$20.00' }));
        expect(svc.onlinePaymentsService.refund).toHaveBeenCalledWith('p1', { amountCents: 2000, reason: 'Started late' });
        await waitFor(() => expect(screen.queryByTestId('refund-dialog')).toBeNull());
        expect(toast).toHaveBeenCalledWith('Refund sent', 'success', 6000);
        expect(svc.onlinePaymentsService.balance).toHaveBeenCalledTimes(2);
    });

    it('will not refund more than is left', async () => {
        const user = userEvent.setup();
        render(<PaymentsMoney />);
        await user.click(within(await screen.findByTestId('money-payment')).getByRole('button', { name: 'Refund' }));
        const dlg = screen.getByTestId('refund-dialog');
        await user.clear(within(dlg).getByLabelText(/Amount/));
        await user.type(within(dlg).getByLabelText(/Amount/), '60');
        await user.type(within(dlg).getByLabelText('Why'), 'x');
        await user.click(within(dlg).getByRole('button', { name: 'Refund N$60.00' }));
        expect(within(dlg).getByRole('alert')).toHaveTextContent('At most N$50.00 is left to refund');
        expect(svc.onlinePaymentsService.refund).not.toHaveBeenCalled();
    });

    it('a refund Bookplus must approve says so; the payment then shows it waiting, with no second Refund', async () => {
        const user = userEvent.setup();
        svc.onlinePaymentsService.refund = vi.fn(() => Promise.resolve({ data: { success: true, code: 'approval_required', message: 'This is more than your Bookplus balance, so it was sent to Bookplus to approve. We will let you know.' } }));
        render(<PaymentsMoney />);
        await user.click(within(await screen.findByTestId('money-payment')).getByRole('button', { name: 'Refund' }));
        svc.onlinePaymentsService.payments = vi.fn(() => page([payment({ refundRequest: { _id: 'r1', amountCents: 5000 } })]));
        const dlg = screen.getByTestId('refund-dialog');
        await user.type(within(dlg).getByLabelText('Why'), 'Client was ill');
        await user.click(within(dlg).getByRole('button', { name: 'Refund N$50.00' }));
        await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('sent to Bookplus to approve'), 'info', 6000));
        const row = await screen.findByText(/Waiting for Bookplus to approve a N\$50.00 refund/);
        expect(within(row.closest('li')).queryByRole('button', { name: 'Refund' })).toBeNull();
    });

    it('a refund the card processor did not take can be sent again', async () => {
        const user = userEvent.setup();
        svc.onlinePaymentsService.payments = vi.fn(() => page([payment({
            status: 'refund_pending', refundingCents: 5000, refundableCents: 0,
            refunds: [{ _id: 'rf1', amountCents: 5000, gatewayStatus: 'failed', error: 'Not possible right now' }],
        })]));
        render(<PaymentsMoney />);
        const row = await screen.findByTestId('money-payment');
        expect(row).toHaveTextContent('Refund on its way');
        expect(row).toHaveTextContent('The card processor did not take the N$50.00 refund yet.');
        expect(within(row).queryByRole('button', { name: 'Refund' })).toBeNull();
        await user.click(within(row).getByRole('button', { name: 'Send the refund again' }));
        expect(svc.onlinePaymentsService.retryRefund).toHaveBeenCalledWith('p1', 'rf1');
    });

    it('lists the statement with the balance after each line, and downloads it as CSV', async () => {
        const user = userEvent.setup();
        const createObjectURL = vi.fn(() => 'blob:x');
        const revoke = vi.fn();
        Object.assign(URL, { createObjectURL, revokeObjectURL: revoke });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        render(<PaymentsMoney />);
        const rows = await screen.findAllByTestId('money-statement-row');
        expect(rows[0]).toHaveTextContent('Bookplus commission: Thandi — Haircut');
        expect(rows[0]).toHaveTextContent('−N$3.00');
        expect(rows[0]).toHaveTextContent('N$373.00');
        expect(rows[1]).toHaveTextContent('+N$50.00');
        await user.click(screen.getByRole('button', { name: 'Download (CSV)' }));
        expect(svc.onlinePaymentsService.statementCsv).toHaveBeenCalled();
        expect(createObjectURL).toHaveBeenCalled();
        expect(click).toHaveBeenCalled();
        click.mockRestore();
    });

    it('nothing paid yet says so', async () => {
        svc.onlinePaymentsService.payments = vi.fn(() => page([]));
        svc.onlinePaymentsService.ledger = vi.fn(() => page([]));
        render(<PaymentsMoney />);
        expect(await screen.findByText('No bookings paid online yet.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Download (CSV)' })).toBeDisabled();
    });
});

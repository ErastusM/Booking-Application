import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Account → Online payments: every cost shown per plan, the details form, the
 * documents (private upload), the payout account, the list of what is still
 * missing, sending with the terms accepted, and the switch once approved.
 */
const svc = vi.hoisted(() => ({ onlinePaymentsService: {} }));
const toast = vi.hoisted(() => vi.fn());
const upload = vi.hoisted(() => vi.fn());
vi.mock('../services', () => svc);
vi.mock('./Toast', () => ({ useToast: () => toast }));
vi.mock('../utils/uploadImage', () => ({ uploadVerificationDocument: upload, VERIFICATION_ACCEPT: '.pdf' }));

import OnlinePaymentsSection from './OnlinePaymentsSection';

const PLANS = [
    { key: 'basic', label: 'Basic', trialDays: 30, introMonths: 6, introPriceCents: 6999, priceCents: 14999, commissionBps: 150, fixedFeeCents: 0 },
    { key: 'standard', label: 'Standard', trialDays: 0, introMonths: 0, introPriceCents: 0, priceCents: 0, commissionBps: 300, fixedFeeCents: 150 },
];
const app = (over = {}) => ({
    status: 'draft', plan: null, editable: true, takingPayments: false, switchOn: false, adminOff: false, adminOffReason: '',
    decisionNote: '', payoutAccountReviewNeeded: false, uploadsAvailable: true, canSubmit: false,
    legal: { businessType: null, registeredName: '', registrationNumber: '', ownerName: '', ownerIdNumberMasked: '', hasOwnerIdNumber: false },
    documents: [], missing: ['plan', 'doc_owner_id', 'payoutAccount'],
    plans: PLANS, processingFee: { known: false, bps: null, fixedCents: null, payer: 'business' },
    payout: { frequency: 'weekly', weekday: 5 },
    ...over,
});
const res = (data) => Promise.resolve({ data: { data } });

beforeEach(() => {
    toast.mockReset();
    upload.mockReset();
    svc.onlinePaymentsService = {
        getApplication: vi.fn(() => res(app())),
        getPayoutAccount: vi.fn(() => res({ hasAccount: false })),
        getPayoutAccountForEdit: vi.fn(() => res({ hasAccount: false })),
        updateApplication: vi.fn((body) => res(app({ plan: body.plan || null }))),
        addDocument: vi.fn(() => res(app({ documents: [{ _id: 'd1', kind: 'owner_id', name: 'id.pdf' }] }))),
        removeDocument: vi.fn(() => res(app())),
        updatePayoutAccount: vi.fn(() => Promise.resolve({ data: { message: 'Payout account saved', data: { hasAccount: true, accountHolder: 'Vibe Cuts CC', bankName: 'Bank Windhoek', accountNumberMasked: '•••• 4821' } } })),
        submit: vi.fn(() => res(app({ status: 'submitted', editable: false }))),
        setSwitch: vi.fn((on) => res(app({ status: 'approved', editable: false, switchOn: on, takingPayments: on }))),
    };
});

describe('OnlinePaymentsSection', () => {
    it('shows each plan in full: monthly price, fee per booking, and what a N$200 booking pays out', async () => {
        render(<OnlinePaymentsSection />);
        const basic = await screen.findByTestId('plan-basic');
        expect(basic).toHaveTextContent('Free for 30 days, then N$69.99 a month for 6 months, then N$149.99 a month');
        expect(basic).toHaveTextContent('1.5%');
        expect(basic).toHaveTextContent('you receive N$197.00, before the card processing fee');
        const standard = screen.getByTestId('plan-standard');
        expect(standard).toHaveTextContent('No monthly fee');
        expect(standard).toHaveTextContent('3% + N$1.50');
        expect(standard).toHaveTextContent('you receive N$192.50');
        expect(screen.getByText(/pays it into your bank account, every Friday/)).toBeInTheDocument();
        await userEvent.click(within(standard).getByRole('radio'));
        expect(svc.onlinePaymentsService.updateApplication).toHaveBeenCalledWith({ plan: 'standard' });
    });

    it('lists what is missing; sending needs everything and the terms', async () => {
        svc.onlinePaymentsService.getApplication.mockReturnValueOnce(res(app({ plan: 'standard', missing: [], canSubmit: true })));
        render(<OnlinePaymentsSection />);
        const send = await screen.findByTestId('send-application');
        const button = within(send).getByRole('button', { name: 'Send application' });
        expect(button).toBeDisabled();
        await userEvent.click(within(send).getByRole('checkbox'));
        expect(button).toBeEnabled();
        await userEvent.click(button);
        expect(svc.onlinePaymentsService.submit).toHaveBeenCalled();
        expect(await screen.findByTestId('application-status')).toHaveTextContent('With Bookplus');
        expect(screen.queryByTestId('send-application')).not.toBeInTheDocument();
    });

    it('says what is still needed in plain words', async () => {
        render(<OnlinePaymentsSection />);
        const send = await screen.findByTestId('send-application');
        expect(send).toHaveTextContent('Choose a plan');
        expect(send).toHaveTextContent('Upload the owner\'s ID');
        expect(send).toHaveTextContent('Add the bank account for payouts');
    });

    it('uploads a document privately and attaches it', async () => {
        upload.mockResolvedValue({ ref: { publicId: 'bookplus/verification/u/x', resourceType: 'image', format: 'pdf' }, kind: 'pdf' });
        const { container } = render(<OnlinePaymentsSection />);
        await screen.findByTestId('doc-owner_id');
        const file = new File(['%PDF'], 'id.pdf', { type: 'application/pdf' });
        await userEvent.upload(container.querySelector('#file-owner_id'), file);
        expect(upload).toHaveBeenCalledWith(file);
        expect(svc.onlinePaymentsService.addDocument).toHaveBeenCalledWith({ kind: 'owner_id', name: 'id.pdf', ref: { publicId: 'bookplus/verification/u/x', resourceType: 'image', format: 'pdf' } });
        expect(await within(screen.getByTestId('doc-owner_id')).findByText('id.pdf')).toBeInTheDocument();
    });

    it('a sole trader is not asked for a company registration', async () => {
        render(<OnlinePaymentsSection />);
        await screen.findByTestId('doc-registration');
        await userEvent.selectOptions(screen.getByLabelText('What kind of business is it?'), 'sole_trader');
        expect(screen.queryByTestId('doc-registration')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Registration number')).not.toBeInTheDocument();
    });

    it('saves the bank account', async () => {
        render(<OnlinePaymentsSection />);
        await screen.findByLabelText('Account holder');
        await userEvent.type(screen.getByLabelText('Account holder'), 'Vibe Cuts CC');
        await userEvent.type(screen.getByLabelText('Bank'), 'Bank Windhoek');
        await userEvent.type(screen.getByLabelText('Branch code'), '483872');
        await userEvent.type(screen.getByLabelText('Account number'), '80041234821');
        await userEvent.click(screen.getByRole('button', { name: 'Save bank account' }));
        expect(svc.onlinePaymentsService.updatePayoutAccount).toHaveBeenCalledWith({ accountHolder: 'Vibe Cuts CC', bankName: 'Bank Windhoek', branchCode: '483872', accountNumber: '80041234821' });
        expect(await screen.findByText(/Vibe Cuts CC, Bank Windhoek, •••• 4821/)).toBeInTheDocument();
    });

    it('once approved: the business switches online payments on; locked fields', async () => {
        svc.onlinePaymentsService.getApplication.mockReturnValueOnce(res(app({ status: 'approved', editable: false, plan: 'standard', missing: [] })));
        render(<OnlinePaymentsSection />);
        const sw = await screen.findByTestId('payments-switch');
        expect(screen.getByTestId('application-status')).toHaveTextContent('Approved');
        expect(screen.getByLabelText('Registered business name')).toBeDisabled();
        await userEvent.click(within(sw).getByRole('checkbox'));
        expect(svc.onlinePaymentsService.setSwitch).toHaveBeenCalledWith(true);
        expect(await within(screen.getByTestId('payments-switch')).findByText(/On: clients pay online/)).toBeInTheDocument();
    });

    it('switched off by Bookplus: says why and offers no switch', async () => {
        svc.onlinePaymentsService.getApplication.mockReturnValueOnce(res(app({ status: 'approved', editable: false, adminOff: true, adminOffReason: 'Chargeback investigation' })));
        render(<OnlinePaymentsSection />);
        const sw = await screen.findByTestId('payments-switch');
        expect(sw).toHaveTextContent('Bookplus has switched online payments off for your business: Chargeback investigation');
        expect(within(sw).queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('rejected: shows Bookplus\'s reason and that the documents were deleted', async () => {
        svc.onlinePaymentsService.getApplication.mockReturnValueOnce(res(app({ status: 'rejected', decisionNote: 'The ID does not match the owner' })));
        render(<OnlinePaymentsSection />);
        const status = await screen.findByTestId('application-status');
        expect(status).toHaveTextContent('Not approved');
        expect(status).toHaveTextContent('Bookplus: The ID does not match the owner');
        expect(status).toHaveTextContent('The documents you sent were deleted');
    });
});

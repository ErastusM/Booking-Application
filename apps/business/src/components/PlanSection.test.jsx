import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const svc = vi.hoisted(() => ({ subscriptionService: {} }));
const pay = vi.hoisted(() => ({ goToPayGate: vi.fn() }));
vi.mock('../services', () => svc);
vi.mock('../utils/payGateRedirect', () => pay);

import PlanSection from './PlanSection';
import { goToPayGate as realGoToPayGate } from '../utils/payGateRedirect';

/** Account → Your plan: where the business stands, and adding a card to start the plan. */
const terms = { trialDays: 30, introMonths: 6, introPriceCents: 6999, priceCents: 14999 };
const trial = { status: 'trialing', trialDaysLeft: 12, trialEndsAt: '2026-11-23T10:00:00Z', terms, nextPriceCents: 6999 };

beforeEach(() => {
    pay.goToPayGate.mockReset();
    svc.subscriptionService = {
        startCheckout: vi.fn(),
        checkoutStatus: vi.fn(),
        payments: vi.fn().mockResolvedValue({ data: { data: [] } }),
        cancel: vi.fn().mockResolvedValue({ data: { data: { ok: true } } }),
        keep: vi.fn().mockResolvedValue({ data: { data: { ok: true } } }),
    };
});

describe('PlanSection', () => {
    it('a free trial: days left, the end date, then the introductory and standard prices', () => {
        render(<PlanSection plan={trial} />);
        expect(screen.getByRole('heading', { name: 'Free trial: 12 days left' })).toBeInTheDocument();
        expect(screen.getByText(/ends on 23 November 2026/)).toBeInTheDocument();
        expect(screen.getByText(/N\$69\.99 a month for the first 6 months, then N\$149\.99 a month/)).toBeInTheDocument();
    });

    it('kept free: no prices shown', () => {
        render(<PlanSection plan={{ status: 'exempt', terms: {} }} />);
        expect(screen.getByRole('heading', { name: 'Free' })).toBeInTheDocument();
        expect(screen.queryByText(/N\$/)).not.toBeInTheDocument();
    });

    it('trial ended: says nothing is charged yet', () => {
        render(<PlanSection plan={{ status: 'trial_ended', terms }} />);
        expect(screen.getByRole('heading', { name: 'Your free trial has ended' })).toBeInTheDocument();
        expect(screen.getByText(/Nothing is charged yet/)).toBeInTheDocument();
    });

    it('no "Add card" while card payments for plans are not switched on', () => {
        render(<PlanSection plan={{ ...trial, canAddCard: false }} />);
        expect(screen.queryByRole('button', { name: 'Add card and start plan' })).not.toBeInTheDocument();
    });
});

describe('add card and start plan', () => {
    it('says what is paid now and that the trial is not shortened, then sends the browser to PayGate', async () => {
        const checkout = { reference: 'BS1', redirectUrl: 'https://secure.paygate.co.za/payweb3/process.trans', method: 'POST', fields: { PAY_REQUEST_ID: 'x' } };
        svc.subscriptionService.startCheckout.mockResolvedValue({ data: { data: checkout } });
        render(<PlanSection plan={{ ...trial, canAddCard: true }} />);
        expect(screen.getByText(/You pay N\$69\.99 now for your first month/)).toBeInTheDocument();
        expect(screen.getByText(/starts when your free trial ends on 23 November 2026\. Your trial is not shortened/)).toBeInTheDocument();
        expect(screen.getByText(/Bookplus never sees your card number/)).toBeInTheDocument();

        await userEvent.click(screen.getByRole('checkbox', { name: /I agree to the plan terms/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Add card and start plan' }));
        expect(svc.subscriptionService.startCheckout).toHaveBeenCalledWith(true);
        await waitFor(() => expect(pay.goToPayGate).toHaveBeenCalledWith(checkout));
        expect(screen.getByRole('button', { name: 'Opening PayGate…' })).toBeDisabled();
    });

    it('the button stays off until the owner agrees to the plan terms and the monthly payments', async () => {
        render(<PlanSection plan={{ ...trial, canAddCard: true }} />);
        const box = screen.getByRole('checkbox', { name: /I agree to the plan terms/ });
        expect(box).not.toBeChecked();
        const label = box.closest('label');
        expect(label).toHaveTextContent('authorise Bookplus to charge my card N$69.99 now and every month after that');
        expect(label).toHaveTextContent('until I cancel');
        expect(screen.getByRole('link', { name: 'plan terms' })).toHaveAttribute('href', '/terms#plan');
        const button = screen.getByRole('button', { name: 'Add card and start plan' });
        expect(button).toBeDisabled();
        await userEvent.click(button);
        expect(svc.subscriptionService.startCheckout).not.toHaveBeenCalled();
        await userEvent.click(box);
        expect(button).toBeEnabled();
        await userEvent.click(box);
        expect(button).toBeDisabled();
    });

    it('shows the API\'s message when the payment cannot be started, and lets the owner try again', async () => {
        svc.subscriptionService.startCheckout.mockRejectedValue({ response: { status: 429, data: { message: 'Too many card attempts today. Please try again tomorrow.' } } });
        render(<PlanSection plan={{ ...trial, canAddCard: true }} />);
        await userEvent.click(screen.getByRole('checkbox', { name: /I agree to the plan terms/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Add card and start plan' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Too many card attempts today');
        expect(screen.getByRole('button', { name: 'Add card and start plan' })).toBeEnabled();
        expect(pay.goToPayGate).not.toHaveBeenCalled();
    });

    it('back from PayGate: checks the payment, then says the plan started and reloads it', async () => {
        svc.subscriptionService.checkoutStatus.mockResolvedValue({ data: { data: { reference: 'BS1', status: 'paid' } } });
        const onChanged = vi.fn();
        render(<PlanSection plan={{ ...trial, canAddCard: true }} checkoutRef="BS1" onChanged={onChanged} />);
        expect(await screen.findByRole('heading', { name: 'Your plan has started' })).toBeInTheDocument();
        expect(svc.subscriptionService.checkoutStatus).toHaveBeenCalledWith('BS1');
        expect(onChanged).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Add card and start plan' })).not.toBeInTheDocument();
    });

    it('back from PayGate, declined: nothing charged, and the owner can try again', async () => {
        svc.subscriptionService.checkoutStatus.mockResolvedValue({ data: { data: { reference: 'BS1', status: 'failed' } } });
        render(<PlanSection plan={{ ...trial, canAddCard: true }} checkoutRef="BS1" />);
        expect(await screen.findByRole('heading', { name: 'The payment did not go through' })).toBeInTheDocument();
        expect(screen.getByText(/Nothing was charged/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add card and start plan' })).toBeInTheDocument();
    });

    it('a started plan: paid to, what comes next, and the saved card (brand, last 4, expiry only)', () => {
        render(<PlanSection plan={{
            status: 'active', terms, paidThrough: '2026-12-23T10:00:00Z', introMonthsLeft: 5, canAddCard: false,
            card: { brand: 'Visa', last4: '0002', expMonth: 3, expYear: 2030 },
        }} />);
        expect(screen.getByRole('heading', { name: 'Basic plan' })).toBeInTheDocument();
        expect(screen.getByText(/Paid to 23 December 2026/)).toBeInTheDocument();
        expect(screen.getByText(/N\$69\.99 a month for 5 more months, then N\$149\.99 a month/)).toBeInTheDocument();
        expect(screen.getByTestId('saved-card')).toHaveTextContent('Card: Visa ending 0002, expires 03/2030');
        expect(screen.queryByRole('heading', { name: 'After the trial' })).not.toBeInTheDocument();
    });
});

const active = {
    status: 'active', terms, paidThrough: '2026-12-23T10:00:00Z', nextPaymentAt: '2026-12-23T10:00:00Z', nextPriceCents: 6999,
    introMonthsLeft: 5, paidMonths: 1, card: { brand: 'Visa', last4: '0002', expMonth: 3, expYear: 2030 },
};

describe('the monthly payments', () => {
    it('a started plan says when the next payment is taken and how much', () => {
        render(<PlanSection plan={active} />);
        expect(screen.getByText(/Your next payment of N\$69\.99 is taken from your card on 23 December 2026/)).toBeInTheDocument();
    });

    it('lists the payments made: date, what, amount, reference', async () => {
        svc.subscriptionService.payments.mockResolvedValue({ data: { data: [
            { reference: 'BS2', kind: 'renewal', amountCents: 6999, currency: 'NAD', paidAt: '2026-12-23T10:00:00Z' },
            { reference: 'BS1', kind: 'first', amountCents: 6999, currency: 'NAD', paidAt: '2026-11-10T10:00:00Z' },
        ] } });
        render(<PlanSection plan={active} />);
        const table = await screen.findByTestId('plan-payments');
        expect(table).toHaveTextContent('Monthly payment');
        expect(table).toHaveTextContent('First month');
        expect(table).toHaveTextContent('23 December 2026');
        expect(table).toHaveTextContent('BS1');
    });

    it('no payments asked for during a trial', () => {
        render(<PlanSection plan={trial} />);
        expect(svc.subscriptionService.payments).not.toHaveBeenCalled();
    });

    it('a payment that did not go through: when it is tried again, when the plan is paused, and paying with another card', async () => {
        const checkout = { reference: 'BS3', redirectUrl: 'https://secure.paygate.co.za/payweb3/process.trans', method: 'POST', fields: {} };
        svc.subscriptionService.startCheckout.mockResolvedValue({ data: { data: checkout } });
        render(<PlanSection plan={{
            ...active, status: 'past_due', nextPaymentAt: null, nextAttemptAt: '2026-12-24T10:00:00Z', graceEndsAt: '2026-12-30T10:00:00Z',
            canChangeCard: true, canCancel: true, checkout: { kind: 'card', amountCents: 6999, paidThroughAfter: '2027-01-23T10:00:00Z' },
        }} />);
        const box = screen.getByTestId('past-due');
        expect(box).toHaveTextContent('We will try again on 24 December 2026');
        expect(box).toHaveTextContent('still unpaid on 30 December 2026, your plan is paused');
        expect(screen.getByRole('heading', { name: 'Pay with another card' })).toBeInTheDocument();
        expect(screen.getByText(/for the month that is unpaid, so your plan is paid to 23 January 2027/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('checkbox', { name: /I agree to the plan terms/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Pay with the new card' }));
        expect(svc.subscriptionService.startCheckout).toHaveBeenCalledWith(true);
        await waitFor(() => expect(pay.goToPayGate).toHaveBeenCalledWith(checkout));
    });

    it('paused: says the business is hidden and how to show it again', () => {
        render(<PlanSection plan={{ ...active, status: 'paused', nextPaymentAt: null, canChangeCard: true, checkout: { kind: 'card', amountCents: 6999 } }} />);
        expect(screen.getByRole('heading', { name: 'Your plan is paused' })).toBeInTheDocument();
        expect(screen.getByTestId('paused')).toHaveTextContent('not shown to clients');
        expect(screen.getByText(/for a month starting today, and your business is shown to clients again/)).toBeInTheDocument();
    });

    it('replacing the card while paid up: pays the next month, says to when, and that the old card is deleted', () => {
        render(<PlanSection plan={{ ...active, canChangeCard: true, checkout: { kind: 'card', amountCents: 6999, paidThroughAfter: '2027-01-23T10:00:00Z' } }} />);
        expect(screen.getByRole('heading', { name: 'Replace your card' })).toBeInTheDocument();
        expect(screen.getByText(/for your next month, so your plan is paid to 23 January 2027\. The new card replaces your saved card, which we ask PayGate to delete/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Pay with the new card' })).toBeDisabled();
    });

    it('back from PayGate with a new card: thanks, and the plan is reloaded', async () => {
        svc.subscriptionService.checkoutStatus.mockResolvedValue({ data: { data: { reference: 'BS3', kind: 'card', status: 'paid' } } });
        const onChanged = vi.fn();
        render(<PlanSection plan={{ ...active, canChangeCard: true, checkout: { kind: 'card', amountCents: 6999 } }} checkoutRef="BS3" onChanged={onChanged} />);
        expect(await screen.findByRole('heading', { name: 'Thank you, your payment went through' })).toBeInTheDocument();
        expect(onChanged).toHaveBeenCalledTimes(1);
    });
});

describe('cancelling', () => {
    it('asks first, says the plan runs to the end of the paid month with no part-month refund, then cancels', async () => {
        const onChanged = vi.fn();
        render(<PlanSection plan={{ ...active, canCancel: true }} onChanged={onChanged} />);
        await userEvent.click(screen.getByRole('button', { name: 'Cancel plan' }));
        expect(svc.subscriptionService.cancel).not.toHaveBeenCalled();
        const box = screen.getByTestId('cancel-plan');
        expect(box).toHaveTextContent('your plan stays active until 23 December 2026');
        expect(box).toHaveTextContent('We do not refund part of a month already paid');
        await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel my plan' }));
        expect(svc.subscriptionService.cancel).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    });

    it('changing their mind before confirming changes nothing', async () => {
        render(<PlanSection plan={{ ...active, canCancel: true }} />);
        await userEvent.click(screen.getByRole('button', { name: 'Cancel plan' }));
        await userEvent.click(screen.getByRole('button', { name: 'Keep my plan' }));
        expect(svc.subscriptionService.cancel).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Cancel plan' })).toBeInTheDocument();
    });

    it('with a month unpaid: the plan ends now', async () => {
        render(<PlanSection plan={{ ...active, status: 'past_due', canCancel: true }} />);
        await userEvent.click(screen.getByRole('button', { name: 'Cancel plan' }));
        expect(screen.getByTestId('cancel-plan')).toHaveTextContent('Your plan ends now and nothing more is charged');
    });

    it('cancelled: the end date, no next payment, and "Keep my plan"', async () => {
        const onChanged = vi.fn();
        render(<PlanSection plan={{ ...active, cancelAtPeriodEnd: true, nextPaymentAt: null }} onChanged={onChanged} />);
        expect(screen.getByText(/your card will not be charged again, and your plan ends on 23 December 2026/)).toBeInTheDocument();
        expect(screen.queryByText(/Your next payment/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cancel plan' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Keep my plan' }));
        expect(svc.subscriptionService.keep).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    });

    it('ended: says so, and offers to start again', () => {
        render(<PlanSection plan={{ status: 'cancelled', terms, endedAt: '2026-12-23T10:00:00Z', nextPriceCents: 6999, canAddCard: true, checkout: { kind: 'first', amountCents: 6999 } }} />);
        expect(screen.getByRole('heading', { name: 'Your plan has ended' })).toBeInTheDocument();
        expect(screen.getByText(/ended on 23 December 2026/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add card and start plan' })).toBeInTheDocument();
    });
});

describe('goToPayGate', () => {
    it('only ever posts to an https page', async () => {
        const { goToPayGate } = await vi.importActual('../utils/payGateRedirect');
        expect(() => goToPayGate({ redirectUrl: 'http://evil.example/x', fields: {} })).toThrow(/unavailable/);
        expect(() => goToPayGate({ redirectUrl: 'javascript:alert(1)', fields: {} })).toThrow(/unavailable/);
        const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
        const form = goToPayGate({ redirectUrl: 'https://secure.paygate.co.za/payweb3/process.trans', fields: { PAY_REQUEST_ID: 'abc', CHECKSUM: 'def' } });
        expect(form.method.toLowerCase()).toBe('post');
        expect([...form.querySelectorAll('input')].map((i) => [i.name, i.value])).toEqual([['PAY_REQUEST_ID', 'abc'], ['CHECKSUM', 'def']]);
        expect(submit).toHaveBeenCalled();
        submit.mockRestore();
        form.remove();
        expect(realGoToPayGate).toBe(pay.goToPayGate);
    });
});

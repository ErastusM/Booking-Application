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

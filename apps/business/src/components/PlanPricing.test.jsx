import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * The plan's prices on the sign-up page (Business Subscription Terms,
 * "Pricing transparency"): the free period, the introductory price and its
 * discount, the standard price and the dates, before a business registers.
 */
const svc = vi.hoisted(() => ({ subscriptionService: {} }));
vi.mock('../services', () => svc);

import PlanPricing, { billingDates } from './PlanPricing';

const PLAN = { visible: true, currency: 'NAD', trialDays: 60, introMonths: 1, introPriceCents: 7999, priceCents: 14999, discountPct: 46.67 };
const NOW = new Date('2026-11-14T08:00:00Z');

beforeEach(() => {
    svc.subscriptionService = { plan: vi.fn().mockResolvedValue({ data: { data: PLAN } }) };
});

describe('PlanPricing', () => {
    it('shows the free period, the introductory month with its discount, the standard price and the dates', async () => {
        render(<PlanPricing now={NOW} />);
        const box = await screen.findByTestId('plan-pricing');
        expect(box).toHaveTextContent('The first 60 days are free, with no card needed');
        expect(screen.getByTestId('plan-pricing-trial')).toHaveTextContent('Free until13 January 2027');
        expect(screen.getByTestId('plan-pricing-intro')).toHaveTextContent('First paid month, from 13 January 2027 (46.67% off)');
        expect(screen.getByTestId('plan-pricing-intro')).toHaveTextContent('N$79.99');
        expect(screen.getByTestId('plan-pricing-standard')).toHaveTextContent('Then every month, from 13 February 2027');
        expect(screen.getByTestId('plan-pricing-standard')).toHaveTextContent('N$149.99 a month');
        expect(box).toHaveTextContent('We remind you before each payment');
    });

    it('shows nothing while plans are not shown to businesses, or if the prices cannot be loaded', async () => {
        svc.subscriptionService.plan = vi.fn().mockResolvedValue({ data: { data: { visible: false } } });
        const { unmount } = render(<PlanPricing now={NOW} />);
        await vi.waitFor(() => expect(svc.subscriptionService.plan).toHaveBeenCalled());
        expect(screen.queryByTestId('plan-pricing')).not.toBeInTheDocument();
        unmount();
        svc.subscriptionService.plan = vi.fn().mockRejectedValue(new Error('offline'));
        render(<PlanPricing now={NOW} />);
        await vi.waitFor(() => expect(svc.subscriptionService.plan).toHaveBeenCalled());
        expect(screen.queryByTestId('plan-pricing')).not.toBeInTheDocument();
    });

    it('counts the dates as the API does (a 31st becomes the last day of a shorter month)', () => {
        const { trialEnds, standardFrom } = billingDates({ trialDays: 0, introMonths: 1 }, new Date('2027-01-31T10:00:00Z'));
        expect(trialEnds.toISOString()).toBe('2027-01-31T10:00:00.000Z');
        expect(standardFrom.toISOString()).toBe('2027-02-28T10:00:00.000Z');
    });
});

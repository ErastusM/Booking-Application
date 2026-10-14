import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Admin console, Money → Dashboard and Costs: the headline figures (revenue and
 * net contribution apart), break-even against the running costs, where money
 * is lost, the period choice, and entering a month's running costs.
 */
const svc = vi.hoisted(() => ({ financeService: {} }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('../services', () => svc);
vi.mock('./Toast', () => ({ useToast: () => toast }));

import { DashboardView, CostsView } from './FinanceDashboard';

const group = (over) => ({ bookings: 0, valueCents: 0, commissionCents: 0, netCents: 0, minNetCents: null, negativeBookings: 0, averageNetCents: null, ...over });
const DASH = {
    period: { from: '2026-10-01', to: '2026-10-14', months: ['2026-10'] },
    businesses: { approved: 2, takingPayments: 2, byPlan: { basic: 1, standard: 1, none: 0 }, basicInTrial: 1, basicIntroPrice: 0 },
    revenue: { commissionCents: 1500, commissionExVatCents: 1500, vatRegistered: false, subscriptionCents: 0, totalCents: 1500, byPlan: { basic: 750, standard: 750, none: 0 } },
    bookings: { paidOnline: 3, valueCents: 75000, averageValueCents: 25000 },
    costs: {
        processingCostCents: 2250, processingRecoveredCents: 2250, processingBorneCents: 0, opsCostCents: 300, opsCostPerBookingCents: 100,
        refundsToClientsCents: 10000, refunds: 1, chargebacksLost: 1, chargebackLossCents: 65000, chargebackRecoveredCents: 65000,
        fixedCostsCents: 50000, fixedCostsByCategory: { hosting: 40000, marketing: 10000 }, fixedCostMonthsEntered: ['2026-10'],
    },
    results: {
        netContributionCents: 1200, afterFixedCostsCents: -48800,
        perBooking: { averageNetCents: 400, minNetCents: -50, negativeBookings: 1 },
        breakEven: { fixedCostsCents: 50000, coveredPct: 2, moreBookingsNeeded: 122 },
        byBand: [group({ key: 'under_100', label: 'Under N$100', bookings: 1, valueCents: 5000, netCents: -50, minNetCents: -50, negativeBookings: 1, averageNetCents: -50 }), group({ key: '1000_up', label: 'N$1,000 and more' })],
        byPlan: { basic: group({ bookings: 1, netCents: 650 }), standard: group({ bookings: 2, netCents: 550 }), none: group({}) },
        businesses: { count: 2, negative: 0, rows: [{ providerId: 'b2', businessName: 'Glow Spa', ...group({ bookings: 1, netCents: 650 }) }] },
    },
};
const LAUNCH = { ready: false, items: [{ key: 'a', done: true }, { key: 'b', done: false }, { key: 'c', done: false }] };

beforeEach(() => {
    toast.mockReset();
    svc.financeService = {
        dashboard: vi.fn(() => Promise.resolve({ data: { data: DASH } })),
        getCosts: vi.fn(() => Promise.resolve({ data: { data: { month: '2026-10', items: [{ category: 'hosting', label: 'Server', amountCents: 40000 }], totalCents: 40000, categories: ['hosting', 'maintenance', 'marketing', 'staff', 'other'], updatedBy: 'Dina Director' } } })),
        putCosts: vi.fn(() => Promise.resolve({ data: { data: {} } })),
    };
});

describe('DashboardView', () => {
    it('shows revenue and net contribution apart, break-even, and what is left before launch', async () => {
        const onOpenSettings = vi.fn();
        render(<DashboardView launch={LAUNCH} onLocked={vi.fn()} onOpenSettings={onOpenSettings} />);
        expect(await screen.findByTestId('dash-revenue')).toHaveTextContent('RevenueN$15.00');
        expect(screen.getByTestId('dash-net')).toHaveTextContent('Net contributionN$12.00');
        expect(screen.getByTestId('dash-bookings')).toHaveTextContent('3N$750.00, average N$250.00');
        expect(screen.getByTestId('dash-breakeven')).toHaveTextContent('2%of N$500.00 running costs; about 122 more bookings at the average net');
        expect(screen.getByTestId('dash-businesses')).toHaveTextContent('In the free trial1');
        expect(screen.getByTestId('dash-revenue-detail')).toHaveTextContent('SubscriptionsNot billed yet');
        expect(screen.getByTestId('dash-costs')).toHaveTextContent('Chargebacks lost (1)N$650.00');
        expect(screen.getByTestId('dash-costs')).toHaveTextContent('Running costs: HostingN$400.00');
        expect(screen.getByTestId('dash-launch')).toHaveTextContent('2 of 3 launch items still to do');
        await userEvent.click(screen.getByRole('button', { name: 'See the checklist' }));
        expect(onOpenSettings).toHaveBeenCalled();
    });

    it('points out where money is lost', async () => {
        render(<DashboardView launch={{ ready: true, items: [] }} onLocked={vi.fn()} onOpenSettings={vi.fn()} />);
        const per = await screen.findByTestId('dash-per-booking');
        expect(per).toHaveTextContent('Lowest net−N$0.50');
        expect(per).toHaveTextContent('Bookings that lost money1');
        expect(per).toHaveTextContent('After running costs−N$488.00');
        const band = within(screen.getByTestId('dash-bands')).getAllByTestId('dash-group')[0];
        expect(band).toHaveTextContent('Under N$100−N$0.50');
        expect(band).toHaveTextContent('1 lost money');
        expect(screen.queryByTestId('dash-launch')).toBeNull();
    });

    it('changes the period', async () => {
        render(<DashboardView launch={null} onLocked={vi.fn()} onOpenSettings={vi.fn()} />);
        await screen.findByTestId('dash-revenue');
        await userEvent.click(screen.getByRole('button', { name: 'This year' }));
        await waitFor(() => expect(svc.financeService.dashboard).toHaveBeenLastCalledWith({ from: expect.stringMatching(/^\d{4}-01-01$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
    });

    it('an expired two-step session goes back to the code screen', async () => {
        const onLocked = vi.fn();
        svc.financeService.dashboard = vi.fn(() => Promise.reject({ response: { data: { code: 'mfa_required' } } }));
        render(<DashboardView launch={null} onLocked={onLocked} onOpenSettings={vi.fn()} />);
        await waitFor(() => expect(onLocked).toHaveBeenCalled());
    });
});

describe('CostsView', () => {
    it('a director adds a month\'s costs, with a reason', async () => {
        const user = userEvent.setup();
        render(<CostsView isDirector onLocked={vi.fn()} />);
        await screen.findAllByTestId('cost-row');
        await user.click(screen.getByRole('button', { name: 'Add a cost' }));
        const rows = screen.getAllByTestId('cost-row');
        await user.selectOptions(within(rows[1]).getByLabelText('Category'), 'marketing');
        await user.type(within(rows[1]).getByLabelText('Amount (N$)'), '1,000.50');
        expect(screen.getByTestId('costs-total')).toHaveTextContent('N$1,400.50');
        await user.type(screen.getByLabelText('Why (for the audit log)'), 'October bills');
        await user.click(screen.getByRole('button', { name: 'Save the costs' }));
        expect(svc.financeService.putCosts).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/), [
            { category: 'hosting', label: 'Server', amountCents: 40000 },
            { category: 'marketing', label: '', amountCents: 100050 },
        ], 'October bills');
    });

    it('finance can read them but not change them', async () => {
        render(<CostsView isDirector={false} onLocked={vi.fn()} />);
        const row = (await screen.findAllByTestId('cost-row'))[0];
        expect(within(row).getByLabelText('Amount (N$)')).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Save the costs' })).toBeNull();
        expect(screen.getByText(/Only a director can change them/)).toBeInTheDocument();
    });
});

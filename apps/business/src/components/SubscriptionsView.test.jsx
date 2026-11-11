import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Admin console → Money → Subscriptions: each business's status, moving one
 * (a director, with a reason), and showing plans to businesses.
 */
const svc = vi.hoisted(() => ({ financeService: {} }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('../services', () => svc);
vi.mock('./Toast', () => ({ useToast: () => toast }));

import SubscriptionsView from './SubscriptionsView';

const ROWS = [
    { provider: { _id: 'p1', name: 'Old Salon', email: 'old@x.na', createdAt: '2026-06-01T00:00:00Z' }, status: 'exempt', nextPriceCents: 0 },
    { provider: { _id: 'p2', name: 'New Cuts', email: 'new@x.na', createdAt: '2026-11-10T00:00:00Z' }, status: 'trialing', trialDaysLeft: 29, trialEndsAt: '2026-12-10T00:00:00Z', nextPriceCents: 6999 },
];

beforeEach(() => {
    toast.mockReset();
    svc.financeService = {
        subscriptions: vi.fn().mockResolvedValue({ data: { data: { rows: ROWS, counts: { exempt: 1, trialing: 1 }, showToBusinesses: false, startedAt: '2026-11-11T00:00:00Z' } } }),
        subscriptionTrial: vi.fn().mockResolvedValue({}),
        subscriptionKeepFree: vi.fn().mockResolvedValue({}),
        subscriptionVisibility: vi.fn().mockResolvedValue({}),
    };
});

describe('SubscriptionsView', () => {
    it('lists each business with its status and what it would pay', async () => {
        render(<SubscriptionsView isDirector onLocked={vi.fn()} />);
        const rows = await screen.findAllByTestId('subscription-row');
        expect(rows[0]).toHaveTextContent('Old Salon');
        expect(rows[0]).toHaveTextContent('Kept free');
        expect(rows[0]).toHaveTextContent('Nothing');
        expect(rows[1]).toHaveTextContent('Free trial: 29 days left');
        expect(rows[1]).toHaveTextContent('N$69.99/month');
    });

    it('a director moves a business only with a reason', async () => {
        render(<SubscriptionsView isDirector onLocked={vi.fn()} />);
        const [old] = await screen.findAllByTestId('subscription-row');
        await userEvent.click(within(old).getByRole('button', { name: 'Start free trial' }));
        expect(svc.financeService.subscriptionTrial).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledWith(expect.stringMatching(/reason/), 'error');

        await userEvent.type(screen.getByLabelText(/Reason/), 'Pilot business');
        await userEvent.click(within(old).getByRole('button', { name: 'Start free trial' }));
        expect(svc.financeService.subscriptionTrial).toHaveBeenCalledWith('p1', 'Pilot business');

        await userEvent.type(screen.getByLabelText(/Reason/), 'Go');
        await userEvent.click(screen.getByRole('button', { name: 'Show to businesses' }));
        expect(svc.financeService.subscriptionVisibility).toHaveBeenCalledWith(true, 'Go');
    });

    it('finance without the director role sees no buttons', async () => {
        render(<SubscriptionsView isDirector={false} onLocked={vi.fn()} />);
        await screen.findAllByTestId('subscription-row');
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.getByText('Only a director can change these.')).toBeInTheDocument();
    });
});

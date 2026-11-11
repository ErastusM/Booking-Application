import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanSection from './PlanSection';

/** Account → Your plan: where the business stands, and what comes after the trial. */
const terms = { trialDays: 30, introMonths: 6, introPriceCents: 6999, priceCents: 14999 };

describe('PlanSection', () => {
    it('a free trial: days left, the end date, then the introductory and standard prices', () => {
        render(<PlanSection plan={{ status: 'trialing', trialDaysLeft: 12, trialEndsAt: '2026-11-23T10:00:00Z', terms }} />);
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
});

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * The Money and Settings sections: each view lives under its own group, and an
 * address with a view under the wrong group (or no such view) goes somewhere
 * sensible instead of a blank page.
 */
vi.mock('../../components/MoneyPanel', () => ({ default: ({ view }) => <p>Panel {view}</p> }));

import MoneySection from './MoneySection';

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
const renderAt = (path) => render(
    <MemoryRouter initialEntries={[path]}>
        <Routes>
            <Route path="/bkplus-command/*" element={(
                <>
                    <Where />
                    <Routes>
                        <Route index element={<p>Overview</p>} />
                        <Route path="money" element={<MoneySection view="dashboard" />} />
                        <Route path="money/:view" element={<MoneySection />} />
                        <Route path="settings/:view" element={<MoneySection />} />
                    </Routes>
                </>
            )} />
        </Routes>
    </MemoryRouter>,
);

describe('MoneySection', () => {
    it('shows the view in the address under its group', () => {
        renderAt('/bkplus-command/money/payouts');
        expect(screen.getByRole('heading', { name: 'Payouts' })).toBeInTheDocument();
        expect(screen.getByText('Panel payouts')).toBeInTheDocument();
    });

    it('the dashboard sits at /money', () => {
        renderAt('/bkplus-command/money');
        expect(screen.getByText('Panel dashboard')).toBeInTheDocument();
    });

    it('a settings view under Money moves to Settings', () => {
        renderAt('/bkplus-command/money/prices');
        expect(screen.getByTestId('where')).toHaveTextContent('/bkplus-command/settings/prices');
        expect(screen.getByRole('heading', { name: 'Prices and fees' })).toBeInTheDocument();
    });

    it('a money view under Settings moves to Money', () => {
        renderAt('/bkplus-command/settings/payments');
        expect(screen.getByTestId('where')).toHaveTextContent('/bkplus-command/money/payments');
        expect(screen.getByText('Panel payments')).toBeInTheDocument();
    });

    it('an unknown view goes to the overview', () => {
        renderAt('/bkplus-command/money/bogus');
        expect(screen.getByTestId('where')).toHaveTextContent(/^\/bkplus-command$/);
        expect(screen.getByText('Overview')).toBeInTheDocument();
    });
});

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Money → Settings: "Check the PayGate connection" shows each check and what to fix. */
const svc = vi.hoisted(() => ({ financeService: {} }));
vi.mock('../services', () => svc);

import PaygateCheck from './PaygateCheck';

const items = (over = {}) => [
    { key: 'credentials', label: 'PayGate ID and password', status: 'ok', detail: 'PayGate ID •••• 8888.' },
    { key: 'signature', label: 'PayGate signs with the key Bookplus checks', status: 'fail', detail: 'Set PAYGATE_ENCRYPTION_KEY to the terminal’s Encryption Key.' },
    { key: 'result_page', label: 'The payment result page opens', status: 'warn', detail: 'redirects' },
    { key: 'read_back', label: 'Bookplus can read a payment’s status from PayGate', status: 'skipped', detail: '' },
    ...(over.extra || []),
];

beforeEach(() => {
    svc.financeService = {
        paygateCheck: vi.fn(() => Promise.resolve({ data: { data: { ready: false, failed: 1, items: items() } } })),
    };
});

describe('PaygateCheck', () => {
    it('runs the check and shows each result with what to fix', async () => {
        const user = userEvent.setup();
        render(<PaygateCheck onLocked={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: 'Check the PayGate connection' }));
        expect(await screen.findByTestId('paygate-check-summary')).toHaveTextContent('1 thing to fix before taking payments.');
        expect(within(screen.getByTestId('paygate-check-credentials')).getByText('OK')).toBeInTheDocument();
        const sig = screen.getByTestId('paygate-check-signature');
        expect(within(sig).getByText('Failed')).toBeInTheDocument();
        expect(sig).toHaveTextContent('Set PAYGATE_ENCRYPTION_KEY');
        expect(within(screen.getByTestId('paygate-check-result_page')).getByText('Check')).toBeInTheDocument();
        expect(within(screen.getByTestId('paygate-check-read_back')).getByText('Skipped')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    });

    it('all good says so', async () => {
        svc.financeService.paygateCheck = vi.fn(() => Promise.resolve({ data: { data: { ready: true, failed: 0, items: [{ key: 'session', label: 'PayGate accepts the ID and password', status: 'ok', detail: '' }] } } }));
        render(<PaygateCheck onLocked={vi.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: 'Check the PayGate connection' }));
        expect(await screen.findByTestId('paygate-check-summary')).toHaveTextContent('Everything works.');
    });

    it('an expired two-step session goes back to the code screen', async () => {
        const onLocked = vi.fn();
        svc.financeService.paygateCheck = vi.fn(() => Promise.reject({ response: { data: { code: 'mfa_required' } } }));
        render(<PaygateCheck onLocked={onLocked} />);
        await userEvent.click(screen.getByRole('button', { name: 'Check the PayGate connection' }));
        expect(onLocked).toHaveBeenCalled();
    });
});

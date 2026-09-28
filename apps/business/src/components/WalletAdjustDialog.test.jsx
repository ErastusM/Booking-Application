import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WalletAdjustDialog from './WalletAdjustDialog';

const PROVIDERS = [
    { _id: 'p1', name: 'Owner One', email: 'one@x.test', businessProfile: { businessName: 'Vido Barber' } },
    { _id: 'p2', name: 'Owner Two', email: 'two@x.test', businessProfile: { businessName: 'New Salon' } },
];

describe('WalletAdjustDialog', () => {
    it('lists any business, marks ones with no wallet, and credits one', async () => {
        const submit = vi.fn().mockResolvedValue();
        render(
            <WalletAdjustDialog
                searchProviders={() => Promise.resolve(PROVIDERS)}
                walletFor={(id) => (id === 'p1' ? { balance: 40 } : undefined)}
                submit={submit}
                onClose={() => {}}
            />,
        );
        await waitFor(() => expect(screen.getByText('New Salon')).toBeInTheDocument());
        expect(screen.getByText('No wallet yet · N$0.00')).toBeInTheDocument();
        expect(screen.getByText('Balance N$40.00')).toBeInTheDocument();
        fireEvent.click(screen.getByText('New Salon'));
        fireEvent.change(screen.getByLabelText('Amount (N$)'), { target: { value: '75' } });
        fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Launch credit' } });
        const btn = screen.getByRole('button', { name: 'Credit N$75.00 to New Salon' });
        fireEvent.click(btn);
        await waitFor(() => expect(submit).toHaveBeenCalledWith({ provider: PROVIDERS[1], direction: 'credit', amount: 75, reason: 'Launch credit' }));
    });

    it('shows the API error (e.g. an over-debit) and stays open', async () => {
        const submit = vi.fn().mockRejectedValue({ response: { data: { message: 'Provider balance is too low for that debit' } } });
        render(
            <WalletAdjustDialog
                initial={PROVIDERS[0]}
                searchProviders={() => Promise.resolve(PROVIDERS)}
                walletFor={() => ({ balance: 40 })}
                submit={submit}
                onClose={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Debit (remove)' }));
        fireEvent.change(screen.getByLabelText('Amount (N$)'), { target: { value: '90' } });
        fireEvent.click(screen.getByRole('button', { name: 'Debit N$90.00 from Vido Barber' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('too low');
    });
});

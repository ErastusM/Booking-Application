import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Wallet "coming soon": gift cards become wallet credit, so the business app
 * shows a coming-soon state instead of Sell or "Turn on client wallet" — even
 * for a business whose own wallet setting is still on.
 */
vi.mock('../../services', () => ({
    giftCardService: { list: () => Promise.resolve({ data: { data: { cards: [], totals: { sold: 0, unused: 0 }, walletEnabled: true } } }) },
    walletService: { updateSettings: vi.fn() },
}));
vi.mock('../../components/Toast', () => ({ useToast: () => vi.fn() }));

import GiftCards from './GiftCards';

describe('GiftCards while the wallet is coming soon', () => {
    it('shows the coming-soon state and no Sell button', async () => {
        render(<GiftCards currency="NAD" businessName="Glow Studio" />);
        expect(await screen.findByTestId('giftcards-coming-soon')).toHaveTextContent(/Gift cards — coming soon/);
        expect(screen.queryByTestId('giftcard-new')).toBeNull();
        expect(screen.queryByText(/Turn on client wallet/)).toBeNull();
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const resendVerification = vi.fn();
const toast = vi.fn();
vi.mock('../services', () => ({
    authService: { resendVerification: (...a) => resendVerification(...a) },
    reviewService: {}, myProfileService: {}, myStatsService: {}, providerMarketService: {},
}));
vi.mock('../components/Toast', () => ({ useToast: () => toast }));

import { EmailConfirmedRow } from './ProviderAccount';

describe('EmailConfirmedRow', () => {
    beforeEach(() => { resendVerification.mockReset(); toast.mockReset(); });

    it('says the email is confirmed, with no button', () => {
        render(<EmailConfirmedRow user={{ email: 'a@b.c', isVerified: true }} />);
        expect(screen.getByText('Email confirmed')).toBeInTheDocument();
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByText(/Verified|Pending/)).toBeNull();
    });

    it('offers to send the link again when not confirmed', async () => {
        resendVerification.mockResolvedValue({});
        render(<EmailConfirmedRow user={{ email: 'vido@x.com', isVerified: false }} />);
        expect(screen.getByText('Email not confirmed')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Send the link again' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Link sent' })).toBeDisabled());
        expect(resendVerification).toHaveBeenCalledWith('vido@x.com');
        expect(toast).toHaveBeenCalledWith(expect.stringContaining('vido@x.com'), 'success');
    });

    it('shows an error and lets them retry when sending fails', async () => {
        resendVerification.mockRejectedValue(new Error('x'));
        render(<EmailConfirmedRow user={{ email: 'vido@x.com', isVerified: false }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Send the link again' }));
        await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.any(String), 'error'));
        expect(screen.getByRole('button', { name: 'Send the link again' })).toBeEnabled();
    });
});

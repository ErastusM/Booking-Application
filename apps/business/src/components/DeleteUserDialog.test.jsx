import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import DeleteUserDialog from './DeleteUserDialog';

describe('DeleteUserDialog', () => {
    it('a business owner: shows the counts and needs DELETE typed before the red button works', async () => {
        const onConfirm = vi.fn();
        render(
            <DeleteUserDialog
                user={{ _id: 'p1', name: 'Vido Owner', role: 'provider' }}
                loadPreview={() => Promise.resolve({ services: 2, teamMembers: 1, staffLogins: 0, upcomingBookings: 3, pastBookings: 9 })}
                onConfirm={onConfirm}
                onClose={() => {}}
            />,
        );
        expect(screen.getByRole('heading', { name: 'Delete Vido Owner?' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText(/3 upcoming bookings cancelled/)).toBeInTheDocument());
        expect(screen.getByText('No emails are sent')).toBeInTheDocument();
        const btn = screen.getByRole('button', { name: 'Delete business owner' });
        expect(btn).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'delete' } });
        expect(btn).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } });
        expect(btn).toBeEnabled();
        fireEvent.click(btn);
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('a client: says their name stays, one click', async () => {
        const onConfirm = vi.fn();
        render(
            <DeleteUserDialog
                user={{ _id: 'c1', name: 'Maria', role: 'customer' }}
                loadPreview={() => Promise.resolve({ bookings: 2 })}
                onConfirm={onConfirm}
                onClose={() => {}}
            />,
        );
        await act(async () => { await Promise.resolve(); }); // the preview loads
        expect(screen.getByText(/name stays on their past bookings/)).toBeInTheDocument();
        expect(screen.queryByLabelText('Type DELETE to confirm')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Delete user' }));
        expect(onConfirm).toHaveBeenCalled();
    });
});

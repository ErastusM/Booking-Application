import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The service editor carries what left the Services tab's rows: the owner's
 * "You offer this service" switch (saved with the service) and, for an existing
 * service, Delete (owner) / "Remove from my services" (team member).
 */
const svc = vi.hoisted(() => ({ updateMyService: vi.fn(), createMyService: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { role: 'provider', businessProfile: { currency: 'NAD' } } }));
vi.mock('../services', () => ({ providerServiceService: svc, categoryService: { createCategory: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuthContext: () => auth }));

import ServiceFormModal from './ServiceFormModal';

const HAIRCUT = { _id: 's1', name: 'Haircut', description: 'Cut', price: 120, duration: 45, category: null, ownerPerforms: true };

const renderModal = (props = {}) => {
    const handlers = { onClose: vi.fn(), onSaved: vi.fn(), onDelete: vi.fn(async () => {}) };
    render(<ServiceFormModal open editing={HAIRCUT} categories={[]} {...handlers} {...props} />);
    return handlers;
};

beforeEach(() => {
    svc.updateMyService.mockReset().mockResolvedValue({ data: { data: HAIRCUT } });
    svc.createMyService.mockReset().mockResolvedValue({ data: { data: HAIRCUT } });
    auth.user = { role: 'provider', businessProfile: { currency: 'NAD' } };
});

describe('ServiceFormModal — the owner', () => {
    it('saves "You offer this service" for an existing service', async () => {
        const { onSaved } = renderModal();
        const sw = screen.getByTestId('service-owner-performs');
        expect(sw).toBeChecked();
        await userEvent.click(sw);
        expect(sw).not.toBeChecked();
        await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        expect(svc.updateMyService).toHaveBeenCalledWith('s1', expect.objectContaining({ ownerPerforms: false }));
        expect(onSaved).toHaveBeenCalled();
    });

    it('deletes an existing service from the bottom of the editor', async () => {
        const { onDelete } = renderModal({ deleteLabel: 'Delete service' });
        await userEvent.click(screen.getByRole('button', { name: 'Delete service' }));
        expect(onDelete).toHaveBeenCalledWith(HAIRCUT);
    });

    it('offers no delete while adding a new service', () => {
        renderModal({ editing: null });
        expect(screen.getByRole('heading', { name: 'New service' })).toBeInTheDocument();
        expect(screen.queryByTestId('service-delete')).not.toBeInTheDocument();
    });

    it('calls a service with no category "Other services", as the customer app does', () => {
        renderModal();
        expect(screen.getByTestId('service-category')).toHaveTextContent('Other services (no category)');
        expect(screen.queryByText(/Featured/)).not.toBeInTheDocument();
    });
});

describe('ServiceFormModal — a team member', () => {
    beforeEach(() => { auth.user = { role: 'staff', businessProfile: {} }; });

    it('has no owner switch, and removes the service from their own list', async () => {
        const memberSave = vi.fn(async () => {});
        const { onDelete } = renderModal({ memberSave, businessName: 'Vido Barber', deleteLabel: 'Remove from my services' });
        expect(screen.queryByTestId('service-owner-performs')).not.toBeInTheDocument();
        expect(screen.queryByText('You offer this service')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Remove from my services' }));
        expect(onDelete).toHaveBeenCalledWith(HAIRCUT);
        expect(svc.updateMyService).not.toHaveBeenCalled();
    });
});

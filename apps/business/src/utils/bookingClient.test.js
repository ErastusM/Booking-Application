import { describe, it, expect } from 'vitest';
import { bookingClientFields } from './bookingClient';

// The CRM roster as GET /api/crm/clients returns it: a registered client keyed
// by account id, a past walk-in keyed "walkin:<lowercased name>".
const roster = [
    { customer: { _id: '65f0c0ffee0000000000abcd', name: 'Amber Daries', email: 'amber@example.com' } },
    { customer: { _id: 'walkin:oom clayton', name: 'Oom Clayton', email: null, isWalkIn: true } },
];

describe('bookingClientFields — who a New Appointment is for', () => {
    it('books a registered client by account id', () => {
        expect(bookingClientFields({ clientMode: 'existing', customerId: '65f0c0ffee0000000000abcd' }, roster))
            .toEqual({ customerId: '65f0c0ffee0000000000abcd', walkInName: undefined });
    });

    it('books a past walk-in picked from the list by name, never as a customerId', () => {
        // Sending "walkin:oom clayton" as customerId was a 400 "Invalid client ID"
        // (one service) or a 500 (several services).
        expect(bookingClientFields({ clientMode: 'existing', customerId: 'walkin:oom clayton' }, roster))
            .toEqual({ customerId: undefined, walkInName: 'Oom Clayton' });
    });

    it('falls back to the name inside the id when the walk-in is not in the loaded list', () => {
        expect(bookingClientFields({ clientMode: 'existing', customerId: 'walkin:jyden strauss' }, roster))
            .toEqual({ customerId: undefined, walkInName: 'jyden strauss' });
    });

    it('leaves a nameless walk-in id for the API to refuse, rather than booking the owner', () => {
        expect(bookingClientFields({ clientMode: 'existing', customerId: 'walkin:' }, []))
            .toEqual({ customerId: 'walkin:', walkInName: undefined });
    });

    it('books a Guest by the typed name, trimmed, and ignores any client left picked', () => {
        expect(bookingClientFields({ clientMode: 'walkin', clientName: '  Jane Doe ', customerId: '65f0c0ffee0000000000abcd' }, roster))
            .toEqual({ customerId: undefined, walkInName: 'Jane Doe' });
        expect(bookingClientFields({ clientMode: 'walkin', clientName: '   ' }, roster))
            .toEqual({ customerId: undefined, walkInName: undefined });
    });

    it('sends neither when no client is chosen', () => {
        expect(bookingClientFields({ clientMode: 'existing', customerId: '' }, roster))
            .toEqual({ customerId: undefined, walkInName: undefined });
        expect(bookingClientFields(undefined, undefined))
            .toEqual({ customerId: undefined, walkInName: undefined });
    });
});

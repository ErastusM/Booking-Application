// Who a New Appointment booking is for, as the two fields the create endpoints
// read: customerId (a registered client's account id) and walkInName (a client
// with no account), plus, for a new client, guestPhone/guestEmail/newClient.
//
// The "Select a client" picker lists the CRM roster (GET /api/crm/clients),
// which includes past walk-ins under the id "walkin:<lowercased name>". The API
// only takes a real user id as customerId: a walk-in id is a 400 "Invalid
// client ID" on POST /api/appointments and a cast error (500) on /multi. So a
// picked walk-in is booked by name, the way Guest is, which the CRM roll-up
// files under the same walkin:<name> key (it matches the name case-blind).
//
// Group bookings carry their own client list and do not come through here.

export const WALKIN_PREFIX = 'walkin:';

export const bookingClientFields = ({ clientMode, customerId, clientName, newClient } = {}, clients = []) => {
    // A new client: booked by name like a walk-in, with the phone (and email)
    // typed in, so the API keeps them and files the client under My Clients.
    if (clientMode === 'new') {
        if (!newClient?.name) return { customerId: undefined, walkInName: undefined };
        return {
            customerId: undefined,
            walkInName: newClient.name,
            guestPhone: newClient.phone,
            ...(newClient.email ? { guestEmail: newClient.email } : {}),
            newClient: true,
        };
    }
    if (clientMode === 'walkin') {
        return { customerId: undefined, walkInName: String(clientName || '').trim() || undefined };
    }
    if (clientMode !== 'existing' || !customerId) return { customerId: undefined, walkInName: undefined };
    if (!String(customerId).startsWith(WALKIN_PREFIX)) return { customerId, walkInName: undefined };
    // The name as the owner saw it in the picker; the id only keeps it lowercased.
    const shown = (clients || []).find((c) => c?.customer?._id === customerId)?.customer?.name;
    const name = String(shown || '').trim() || String(customerId).slice(WALKIN_PREFIX.length).trim();
    // No name to book under (the roster never lists a blank walk-in): send the id
    // as-is so the API refuses it, rather than booking the owner as the client.
    return name ? { customerId: undefined, walkInName: name } : { customerId, walkInName: undefined };
};

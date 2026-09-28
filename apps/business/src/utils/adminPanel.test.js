import { describe, it, expect } from 'vitest';
import {
    appointmentClient, appointmentBusiness, roleLabel, userActions, deleteDialog, suspendDialog,
    removeAdminConfirmText, walletLine, adjustButtonLabel, walletToast, nonAdminNotice,
} from './adminPanel';

describe('appointmentClient — who a booking is for', () => {
    it('a registered client', () => {
        expect(appointmentClient({ customer: { name: 'Maria S', email: 'm@x.test' } })).toEqual({ name: 'Maria S', email: 'm@x.test', tag: null });
    });
    it('a guest gets a Guest tag, a walk-in a Walk-in tag', () => {
        expect(appointmentClient({ customer: null, guestName: 'Gina', guestEmail: 'g@x.test' })).toMatchObject({ name: 'Gina', tag: 'Guest' });
        expect(appointmentClient({ customer: null, walkInName: 'Wanda' })).toMatchObject({ name: 'Wanda', tag: 'Walk-in' });
    });
    it('a deleted client keeps their name with a Deleted account tag', () => {
        expect(appointmentClient({ customer: null, walkInName: 'Maria S', clientAccountDeletedAt: '2026-09-01' }))
            .toMatchObject({ name: 'Maria S', tag: 'Deleted account' });
    });
    it('never blank, even for old rows with no name at all', () => {
        expect(appointmentClient({ customer: null }).name).toBe('Deleted account');
    });
});

describe('appointmentBusiness', () => {
    it('business name, then owner name; removed and suspended are flagged', () => {
        expect(appointmentBusiness({ provider: { name: 'Owner', businessProfile: { businessName: 'Vido Barber' } } }).name).toBe('Vido Barber');
        expect(appointmentBusiness({ provider: { name: 'Owner', businessProfile: { businessName: '' } } }).name).toBe('Owner');
        expect(appointmentBusiness({ provider: null })).toEqual({ name: 'Removed business', removed: true });
        expect(appointmentBusiness({ provider: { name: 'O', isActive: false, deactivatedAt: null } }).suspended).toBe(true);
    });
});

describe('roleLabel', () => {
    it('says Business owner and Staff · <business>', () => {
        expect(roleLabel({ role: 'provider' })).toBe('Business owner');
        expect(roleLabel({ role: 'customer' })).toBe('Customer');
        expect(roleLabel({ role: 'admin' })).toBe('Admin');
        expect(roleLabel({ role: 'staff', staffOf: { name: 'O', businessProfile: { businessName: 'Vido Barber' } } })).toBe('Staff · Vido Barber');
        expect(roleLabel({ role: 'staff', staffOf: 'abc' })).toBe('Staff');
    });
});

describe('userActions', () => {
    const me = { _id: 'me' };
    it('your own row has no actions', () => {
        const a = userActions({ _id: 'me', role: 'admin' }, me, 3);
        expect(a.self).toBe(true);
        expect([a.canDelete, a.canSuspend, a.canMakeAdmin, a.canRemoveAdmin]).toEqual([false, false, false, false]);
    });
    it('recognises the signed-in user by `id` too (the login payload)', () => {
        expect(userActions({ _id: 'me', role: 'admin' }, { id: 'me' }).self).toBe(true);
    });
    it('another admin: Remove admin, Delete disabled until then', () => {
        const a = userActions({ _id: 'x', role: 'admin', roleBeforeAdmin: 'provider' }, me, 2);
        expect(a.canRemoveAdmin).toBe(true);
        expect(a.removeAdminTo).toBe('provider');
        expect(a.canDelete).toBe(false);
        expect(a.deleteBlocked).toMatch(/remove admin first/i);
        expect(a.canSuspend).toBe(false);
    });
    it('no Remove admin for the seeded admin or the last admin; unrecorded admins go to customer', () => {
        expect(userActions({ _id: 'x', role: 'admin', isSuperAdmin: true }, me, 5).canRemoveAdmin).toBe(false);
        expect(userActions({ _id: 'x', role: 'admin' }, me, 1).canRemoveAdmin).toBe(false);
        const a = userActions({ _id: 'x', role: 'admin' }, me, 2);
        expect(a.removeAdminTo).toBe('customer');
        expect(a.removeAdminUnrecorded).toBe(true);
    });
    it('staff are never offered Make admin, and their business removes them', () => {
        const a = userActions({ _id: 's', role: 'staff', staffOf: 'biz' }, me);
        expect(a.canMakeAdmin).toBe(false);
        expect(a.canDelete).toBe(false);
    });
    it('clients and owners: Make admin, Suspend, Delete', () => {
        const a = userActions({ _id: 'c', role: 'customer' }, me);
        expect([a.canMakeAdmin, a.canSuspend, a.canDelete]).toEqual([true, true, true]);
    });
});

describe('deleteDialog', () => {
    it('a business owner: counts, no emails, past bookings stay, type DELETE', () => {
        const d = deleteDialog({ name: 'Vido', role: 'provider' }, { services: 3, teamMembers: 2, staffLogins: 1, upcomingBookings: 1, pastBookings: 40 });
        expect(d.title).toBe('Delete Vido?');
        expect(d.requireTyping).toBe('DELETE');
        expect(d.confirmLabel).toBe('Delete business owner');
        const all = d.bullets.join(' | ');
        expect(all).toMatch(/3 services switched off/);
        expect(all).toMatch(/2 team members/);
        expect(all).toMatch(/1 upcoming booking cancelled as “Business removed”/);
        expect(all).toMatch(/No emails are sent/);
        expect(all).toMatch(/Past bookings \(40\) stay for revenue history/);
    });
    it('a client: their name stays, no typing needed', () => {
        const d = deleteDialog({ name: 'Maria', role: 'customer' });
        expect(d.requireTyping).toBeNull();
        expect(d.intro).toMatch(/name stays on their past bookings/);
        expect(d.intro).toMatch(/account, email and phone are removed/);
    });
});

describe('suspendDialog', () => {
    it('explains what a suspension does to a business and how to undo it', () => {
        const d = suspendDialog({ name: 'Vido', role: 'provider', isActive: true });
        expect(d.bullets.join(' ')).toMatch(/can’t sign in.*disappears from search.*existing upcoming bookings stay/);
        expect(d.footer).toBe('Activate the account to bring everything back.');
        expect(suspendDialog({ name: 'Vido', role: 'provider', isActive: false }).confirmLabel).toBe('Activate');
    });
});

describe('wallet wording', () => {
    it('no wallet yet, button and toasts', () => {
        expect(walletLine(undefined)).toBe('No wallet yet · N$0.00');
        expect(walletLine({ balance: 12.5 })).toBe('Balance N$12.50');
        expect(adjustButtonLabel('credit', '50', 'Vido Barber')).toBe('Credit N$50.00 to Vido Barber');
        expect(adjustButtonLabel('debit', '5', 'Vido Barber')).toBe('Debit N$5.00 from Vido Barber');
        expect(walletToast('credit', 50, 'Vido Barber', 150)).toBe('Credited N$50.00 to Vido Barber · new balance N$150.00');
        expect(walletToast('reject', 20, 'Vido Barber')).toBe('Rejected N$20.00 top-up from Vido Barber');
    });
    it('remove-admin wording follows the recorded role', () => {
        expect(removeAdminConfirmText({ name: 'A', roleBeforeAdmin: 'provider' }).message).toMatch(/business owner/);
        expect(removeAdminConfirmText({ name: 'A' }).message).toMatch(/become a customer/);
    });
});

describe('nonAdminNotice', () => {
    it('is role-specific', () => {
        expect(nonAdminNotice('staff').text).toMatch(/team member/);
        expect(nonAdminNotice('provider').text).toMatch(/business owner/);
    });
});

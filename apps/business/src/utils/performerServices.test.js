import { describe, it, expect } from 'vitest';
import { servicesFor, ownerPerforms, memberPerforms, teamPerformers } from './performerServices';

// A barbershop whose driver added his own trips: the catalogue holds both, but
// only the owner's services are the owner's — each person books at their price.
const haircut = { _id: 'h', name: 'Haircut', price: 120, duration: 45 };                 // legacy row: no flag
const beard = { _id: 'b', name: 'Beard trim', price: 60, duration: 20, ownerPerforms: true };
const trip = { _id: 't', name: 'Long trip', price: 20000, duration: 3600, ownerPerforms: false };
const retired = { _id: 'r', name: 'Old cut', price: 10, duration: 10, isActive: false };
const catalogue = [haircut, beard, trip, retired];

const erastus = {
    _id: 'e', name: 'Erastus Driver', offersAllServices: false,
    services: [{ _id: 't' }, 'h'],
    serviceOverrides: [{ service: 'h', price: 170, duration: null }, { service: { _id: 't' }, price: 20000, duration: 3600 }],
};
const john = { _id: 'j', name: 'John', offersAllServices: false, services: ['h', 'b'], serviceOverrides: [] };

describe('servicesFor — what New Appointment offers for each professional', () => {
    it('the owner ("Me / unassigned") gets only their own services, at the menu price', () => {
        const list = servicesFor(catalogue, null);
        expect(list.map((s) => s.name)).toEqual(['Haircut', 'Beard trim']);
        expect(list.find((s) => s._id === 'h').price).toBe(120);
    });

    it('a member gets only theirs, at THEIR price', () => {
        const list = servicesFor(catalogue, erastus);
        expect(list.map((s) => s.name)).toEqual(['Haircut', 'Long trip']);
        expect(list.find((s) => s._id === 'h').price).toBe(170); // his override
        expect(list.find((s) => s._id === 'h').duration).toBe(45); // null override → the menu's
        expect(servicesFor(catalogue, john).map((s) => s.name)).toEqual(['Haircut', 'Beard trim']);
    });

    it('"show every service" is an override that still prices for the professional', () => {
        const all = servicesFor(catalogue, null, { all: true });
        expect(all.map((s) => s.name)).toEqual(['Haircut', 'Beard trim', 'Long trip']);
        const forErastus = servicesFor(catalogue, erastus, { all: true });
        expect(forErastus.find((s) => s._id === 'b').price).toBe(60);
    });

    it('never offers a retired service', () => {
        expect(servicesFor(catalogue, null, { all: true }).some((s) => s._id === 'r')).toBe(false);
    });
});

describe('who performs a service', () => {
    it('reads an unset owner flag as "yes" (old rows keep working)', () => {
        expect(ownerPerforms(haircut)).toBe(true);
        expect(ownerPerforms(trip)).toBe(false);
    });

    it('members: offers-everything, own list, and the legacy empty-list rule', () => {
        expect(memberPerforms({ offersAllServices: true, services: [] }, 'x')).toBe(true);
        expect(memberPerforms({ offersAllServices: false, services: [] }, 'x')).toBe(false);
        expect(memberPerforms({ services: [] }, 'x')).toBe(true);
        expect(memberPerforms({ services: ['y'] }, 'x')).toBe(false);
    });

    it('lists the active, bookable team members who perform it', () => {
        const desk = { _id: 'd', name: 'Desk', offersAllServices: true, bookable: false };
        const gone = { _id: 'g', name: 'Gone', offersAllServices: true, isActive: false };
        expect(teamPerformers(trip, [erastus, john, desk, gone]).map((m) => m._id)).toEqual(['e']);
    });
});

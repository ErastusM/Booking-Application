import { describe, it, expect } from 'vitest';
import { compareClients, sortClients } from './clientSort';

// Rows shaped like GET /api/crm/clients (and the wallet rows).
const row = (name, email = null, _id = name) => ({ customer: { _id, name, email } });
const names = (rows) => rows.map((r) => r.customer.name);

describe('sortClients — alphabetical client lists', () => {
    it('puts the New Appointment picker in A–Z order (the owner\'s screenshot)', () => {
        // The API sends these by most recent visit — the order the picker used to show.
        const fromApi = [
            row('Rowan Rooi', 'rowan@example.com'),
            row('Jyden strauss', null, 'walkin:jyden strauss'),
            row('Enrico Antoncich', 'enrico@example.com'),
            row('Warren', 'warren@example.com'),
            row('Amber Daries', 'amber@example.com'),
            row('Kenan Walters', 'kenan@example.com'),
            row('Oom Clayton', null, 'walkin:oom clayton'),
            row('Sanchez', 'sanchez@example.com'),
            row('Ellery Innes', 'ellery@example.com'),
            row('Jyde strauss', 'jyde@example.com'),
            row('Adriel', 'adriel@example.com'),
        ];
        expect(names(sortClients(fromApi))).toEqual([
            'Adriel', 'Amber Daries', 'Ellery Innes', 'Enrico Antoncich', 'Jyde strauss',
            'Jyden strauss', 'Kenan Walters', 'Oom Clayton', 'Rowan Rooi', 'Sanchez', 'Warren',
        ]);
    });

    it('ignores case, so lowercase names are not pushed to the end', () => {
        expect(names(sortClients([row('moses'), row('Zed'), row('Amber'), row('amber b')])))
            .toEqual(['Amber', 'amber b', 'moses', 'Zed']);
    });

    it('ignores accents', () => {
        expect(names(sortClients([row('Frank'), row('Émile'), row('Anna')])))
            .toEqual(['Anna', 'Émile', 'Frank']);
    });

    it('orders numbers by value, not character by character', () => {
        expect(names(sortClients([row('Client 10'), row('Client 2'), row('Client 1')])))
            .toEqual(['Client 1', 'Client 2', 'Client 10']);
    });

    it('sorts on the trimmed name', () => {
        expect(names(sortClients([row('Bea'), row('  Adam')]))).toEqual(['  Adam', 'Bea']);
    });

    it('breaks a name tie by email (a walk-in, with none, first), then by id', () => {
        const sorted = sortClients([
            row('Sam', 'zsam@example.com', 'u2'),
            row('Sam', 'asam@example.com', 'u1'),
            row('Sam', null, 'walkin:sam'),
        ]);
        expect(sorted.map((r) => r.customer._id)).toEqual(['walkin:sam', 'u1', 'u2']);
        expect(compareClients(row('Sam', null, 'a'), row('Sam', null, 'b'))).toBeLessThan(0);
    });

    it('puts rows with no name last, not at the top', () => {
        // e.g. a wallet whose client account was deleted (customer: null), shown as "—".
        const sorted = sortClients([{ customer: null }, row('Zed'), row(undefined, null, 'x'), row('   ', null, 'y'), row('Bea')]);
        expect(sorted).toHaveLength(5);
        expect(sorted.slice(0, 2).map((r) => r.customer.name)).toEqual(['Bea', 'Zed']);
        // The nameless rows still order deterministically among themselves (by email, then id).
        expect(sorted.slice(2).map((r) => r.customer?._id ?? null)).toEqual([null, 'x', 'y']);
    });

    it('returns a copy and leaves the input untouched', () => {
        const input = [row('Zed'), row('Amber')];
        const out = sortClients(input);
        expect(out).not.toBe(input);
        expect(names(input)).toEqual(['Zed', 'Amber']);
        expect(sortClients(undefined)).toEqual([]);
    });
});

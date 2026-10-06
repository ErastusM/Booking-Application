/**
 * The wallet switch has two halves: WALLET_ENABLED for the API and
 * FEATURES.walletEnabled in packages/config/features.mjs for both apps. Both
 * default OFF (wallet "coming soon"); this keeps the app default and the API
 * default in step so re-enabling is a deliberate change to both.
 */
const fs = require('fs');
const path = require('path');
const { walletEnabled, membershipsEnabled, paymentsEnabled } = require('../../constants/features');

describe('wallet feature switch', () => {
    it('the apps default to off', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../../../../packages/config/features.mjs'), 'utf8');
        expect(src).toMatch(/walletEnabled:\s*false/);
    });

    it('the API defaults to off when WALLET_ENABLED is unset, and only "true" turns it on', () => {
        const prev = process.env.WALLET_ENABLED;
        try {
            delete process.env.WALLET_ENABLED;
            expect(walletEnabled()).toBe(false);
            process.env.WALLET_ENABLED = '1';
            expect(walletEnabled()).toBe(false);
            process.env.WALLET_ENABLED = 'true';
            expect(walletEnabled()).toBe(true);
        } finally {
            process.env.WALLET_ENABLED = prev;
        }
    });
});

describe('memberships feature switch', () => {
    it('the apps default to off', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../../../../packages/config/features.mjs'), 'utf8');
        expect(src).toMatch(/membershipsEnabled:\s*false/);
    });

    it('the API defaults to off when MEMBERSHIPS_ENABLED is unset, and only "true" turns it on', () => {
        const prev = process.env.MEMBERSHIPS_ENABLED;
        try {
            delete process.env.MEMBERSHIPS_ENABLED;
            expect(membershipsEnabled()).toBe(false);
            process.env.MEMBERSHIPS_ENABLED = '1';
            expect(membershipsEnabled()).toBe(false);
            process.env.MEMBERSHIPS_ENABLED = 'true';
            expect(membershipsEnabled()).toBe(true);
        } finally {
            process.env.MEMBERSHIPS_ENABLED = prev;
        }
    });
});

describe('payments feature switch', () => {
    it('the apps default to off', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../../../../packages/config/features.mjs'), 'utf8');
        expect(src).toMatch(/paymentsEnabled:\s*false/);
    });

    it('the API defaults to off when PAYMENTS_ENABLED is unset, and only "true" turns it on', () => {
        const prev = process.env.PAYMENTS_ENABLED;
        try {
            delete process.env.PAYMENTS_ENABLED;
            expect(paymentsEnabled()).toBe(false);
            process.env.PAYMENTS_ENABLED = '1';
            expect(paymentsEnabled()).toBe(false);
            process.env.PAYMENTS_ENABLED = 'true';
            expect(paymentsEnabled()).toBe(true);
        } finally {
            process.env.PAYMENTS_ENABLED = prev;
        }
    });
});

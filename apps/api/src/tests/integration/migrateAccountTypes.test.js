/**
 * Reproduces the production block behind "can't use the same email on both
 * sides": an OLD database still carries the pre-account-type global-unique
 * `email_1` index, which rejects the SECOND account for an email even though
 * the app logic allows one customer + one business account. The idempotent
 * migration (run on every boot) drops that index and heals it.
 */
const testDb = require('../helpers/testDb');
const User = require('../../models/User');
const { migrateAccountTypes } = require('../../../scripts/migrate_account_types');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
}));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());

const EMAIL = 'dual-index@example.com';
const mk = (over = {}) => ({
    name: 'X', email: EMAIL, password: 'Password1!', phone: '+15550009999',
    role: 'customer', isVerified: true, ...over,
});

describe('legacy email_1 index blocks a second account; boot migration heals it', () => {
    it('lets one email hold a business AND a customer account after the migration', async () => {
        // Simulate an old production DB: the global-unique email index that
        // predates account types.
        await User.collection.createIndex({ email: 1 }, { unique: true, name: 'email_1' });

        // A business account is created fine…
        await User.create(mk({ role: 'provider', providerCategory: 'Beauty & Grooming', name: 'Biz' }));

        // …but the SAME email as a customer is rejected by email_1 — this is the
        // reported "email already exists" block.
        await expect(User.create(mk({ name: 'Cust' }))).rejects.toMatchObject({ code: 11000 });

        // The migration drops email_1 and ensures the compound unique index.
        const res = await migrateAccountTypes();
        expect(res.droppedOldIndex).toBe(true);

        // Now the customer account for the same email creates successfully, and
        // both accounts coexist (differentiated by account type).
        const cust = await User.create(mk({ name: 'Cust' }));
        expect(cust.accountType).toBe('customer');
        expect(await User.countDocuments({ email: EMAIL })).toBe(2);

        // email_1 is gone; the compound {email, accountType} unique index remains.
        const names = (await User.collection.indexes()).map((i) => i.name);
        expect(names).not.toContain('email_1');
        expect(names).toContain('email_1_accountType_1');
    });
});

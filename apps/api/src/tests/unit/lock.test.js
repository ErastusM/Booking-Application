/**
 * Distributed cron-lock tests. Proves the lock lets exactly one caller in per
 * lease, blocks everyone else while held, and frees on release / lease expiry —
 * the guarantee that keeps reminders from double-firing across api instances.
 */
const testDb = require('../helpers/testDb');
const CronLock = require('../../models/CronLock');
const { withLock, acquireLock, releaseLock } = require('../../utils/lock');

beforeAll(() => testDb.connect());
afterEach(() => testDb.clearDatabase());
afterAll(() => testDb.closeDatabase());

describe('cron lock', () => {
    test('only one of many concurrent acquirers wins the same lock', async () => {
        const results = await Promise.all(
            Array.from({ length: 12 }, () => acquireLock('job-A', 60_000))
        );
        const winners = results.filter(Boolean);
        expect(winners).toHaveLength(1);
    });

    test('a second acquirer is blocked while the lock is held, then succeeds after release', async () => {
        const token = await acquireLock('job-B', 60_000);
        expect(token).toBeTruthy();

        expect(await acquireLock('job-B', 60_000)).toBeNull();

        await releaseLock('job-B', token);
        const token2 = await acquireLock('job-B', 60_000);
        expect(token2).toBeTruthy();
        expect(token2).not.toEqual(token);
    });

    test('an expired lease can be taken over by another instance', async () => {
        const token = await acquireLock('job-C', 60_000);
        expect(token).toBeTruthy();

        // Simulate the holder having crashed long ago: force the lease into the past.
        await CronLock.updateOne({ _id: 'job-C' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

        const token2 = await acquireLock('job-C', 60_000);
        expect(token2).toBeTruthy();
        expect(token2).not.toEqual(token);
    });

    test('releaseLock does not free a lease another instance has taken over', async () => {
        const a = await acquireLock('job-D', 60_000);
        await CronLock.updateOne({ _id: 'job-D' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
        const b = await acquireLock('job-D', 60_000); // b takes over

        await releaseLock('job-D', a); // stale holder tries to release — must be a no-op

        // b still holds it, so a fresh acquire is refused.
        expect(await acquireLock('job-D', 60_000)).toBeNull();
        expect(b).toBeTruthy();
    });

    test('withLock runs fn when free and skips when held', async () => {
        const held = await acquireLock('job-E', 60_000);
        expect(held).toBeTruthy();

        let ran = false;
        const result = await withLock('job-E', 60_000, async () => { ran = true; });
        expect(result).toBe(false); // could not acquire
        expect(ran).toBe(false);

        await releaseLock('job-E', held);
        const result2 = await withLock('job-E', 60_000, async () => { ran = true; });
        expect(result2).toBe(true);
        expect(ran).toBe(true);
    });

    test('withLock releases even if fn throws, so the next tick can re-acquire', async () => {
        await expect(
            withLock('job-F', 60_000, async () => { throw new Error('boom'); })
        ).rejects.toThrow('boom');

        // Lock must be free again despite the throw.
        const token = await acquireLock('job-F', 60_000);
        expect(token).toBeTruthy();
    });
});

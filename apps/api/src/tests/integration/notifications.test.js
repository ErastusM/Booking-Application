/**
 * Notification ownership / IDOR integration tests (finding #18/#19).
 *
 * Proves the fix for the unscoped read/delete handlers: PUT /:id/read and
 * DELETE /:id must operate ONLY on the requester's own notifications. Before
 * the fix, findByIdAndUpdate/findByIdAndDelete matched on the id alone, so any
 * authenticated user could flip-to-read or destroy another tenant's
 * notification by walking ids.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, authHeader } = require('../helpers/factories');
const Notification = require('../../models/Notification');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
}));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const makeNotification = (userId, overrides = {}) =>
    Notification.create({ user: userId, message: 'You have an appointment', ...overrides });

describe('PUT /api/notifications/:id/read — ownership scoping', () => {
    it('owner can mark their own notification read', async () => {
        const owner = await makeUser();
        const note = await makeNotification(owner._id);

        const res = await request(app)
            .put(`/api/notifications/${note._id}/read`)
            .set(authHeader(owner));

        expect(res.status).toBe(200);
        const after = await Notification.findById(note._id);
        expect(after.read).toBe(true);
    });

    it('attacker CANNOT mark a victim\'s notification read', async () => {
        const victim = await makeUser();
        const attacker = await makeUser();
        const victimNote = await makeNotification(victim._id, { read: false });

        await request(app)
            .put(`/api/notifications/${victimNote._id}/read`)
            .set(authHeader(attacker));

        // Victim's notification must be untouched despite any {success:true} body.
        const after = await Notification.findById(victimNote._id);
        expect(after).not.toBeNull();
        expect(after.read).toBe(false);
    });
});

describe('DELETE /api/notifications/:id — ownership scoping', () => {
    it('owner can delete their own notification', async () => {
        const owner = await makeUser();
        const note = await makeNotification(owner._id);

        const res = await request(app)
            .delete(`/api/notifications/${note._id}`)
            .set(authHeader(owner));

        expect(res.status).toBe(200);
        const after = await Notification.findById(note._id);
        expect(after).toBeNull();
    });

    it('attacker CANNOT delete a victim\'s notification', async () => {
        const victim = await makeUser();
        const attacker = await makeUser();
        const victimNote = await makeNotification(victim._id);

        await request(app)
            .delete(`/api/notifications/${victimNote._id}`)
            .set(authHeader(attacker));

        // Victim's notification must still exist despite any {success:true} body.
        const after = await Notification.findById(victimNote._id);
        expect(after).not.toBeNull();
    });
});

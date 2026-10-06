/**
 * What happens when an ADMIN deletes an account (Admin → Users → Delete).
 *
 * The old delete removed only the User row. A business's services, team and
 * hours stayed behind, and because a service whose provider can't be found read
 * as a global marketplace service, a deleted business's menu showed up publicly.
 * A deleted client's bookings lost their name everywhere. This module does the
 * clean-up first, then the row is deleted.
 *
 * Business (provider) — the account and its staff logins are deleted, and:
 *   - upcoming bookings (pending/confirmed, today or later) are CANCELLED with
 *     reason "Business removed". Clients get an in-app notice only: no email and
 *     no push. The normal cancel path emails each client; doing that in bulk
 *     from an admin action is the kind of mass mail we would rather send
 *     deliberately, so it is left out on purpose. Any wallet hold is released.
 *   - services, packages, locations and intake forms are deactivated (rows kept
 *     so past bookings still show what was booked); the team roster, working
 *     hours, shifts, leave, blocked time, categories, waiting lists, client notes
 *     and time-clock records are deleted; clients' saved-business hearts to it
 *     are removed. Past bookings, reviews and wallet/accounting rows stay.
 * Client (customer) — the account is deleted, and every booking they made
 * keeps their NAME (copied into walkInName, which every calendar and table
 * already reads) with clientAccountDeletedAt set; no email or phone is kept.
 * Their notifications, push subscriptions and waiting-list places are deleted.
 * Booking statuses are not changed.
 */
const mongoose = require('mongoose');

const M = (name) => mongoose.model(name);
const load = (file) => require(`../models/${file}`);

const REMOVED_REASON = 'Business removed';

async function cancelUpcomingForBusiness(providerId, adminId) {
    const Appointment = load('Appointment');
    load('Service');
    const walletService = require('./walletService');
    const { ApptPhrase } = require('./apptCopy');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const upcoming = await Appointment.find({
        provider: providerId,
        status: { $in: ['pending', 'confirmed'] },
        appointmentDate: { $gte: today },
    }).populate('service', 'name');
    const notices = [];
    for (const appt of upcoming) {
        appt.status = 'cancelled';
        appt.cancellationReason = REMOVED_REASON;
        appt.statusHistory.push({ status: 'cancelled', changedBy: adminId || null });
        // Guest/walk-in rows were valid when made; skip re-validation of old shapes.
        await appt.save({ validateBeforeSave: false });
        try { await walletService.releaseReservation({ appointmentId: appt._id, resolvedBy: adminId }); } catch (_) { /* keep going */ }
        // Paid online: the business is gone, so the client gets it all back.
        await require('../services/paymentService').onAppointmentCancelled(appt._id, { actor: 'business', by: adminId || null });
        if (appt.customer) {
            notices.push({
                user: appt.customer, type: 'appointment', link: '/appointments',
                message: `${ApptPhrase(appt.service?.name)} was cancelled because the business is no longer on Bookplus.`,
            });
        }
    }
    // In-app only (no email, no push) — see the note at the top.
    if (notices.length) await load('Notification').insertMany(notices).catch(() => {});
    return upcoming.length;
}

async function removeBusinessData(providerId, adminId) {
    ['Service', 'Package', 'Location', 'FormTemplate', 'TeamMember', 'Availability', 'StaffAvailability',
        'Shift', 'TimeOff', 'BlockedTime', 'Category', 'WaitingList', 'ClientNote', 'TimeClock', 'User'].forEach(load);
    const cancelled = await cancelUpcomingForBusiness(providerId, adminId);
    const staff = await M('User').find({ staffOf: providerId, role: 'staff' }).select('_id').lean();
    await Promise.all([
        M('Service').updateMany({ provider: providerId }, { $set: { isActive: false } }),
        M('Package').updateMany({ provider: providerId }, { $set: { isActive: false } }),
        M('Location').updateMany({ provider: providerId }, { $set: { isActive: false } }),
        M('FormTemplate').updateMany({ provider: providerId }, { $set: { isActive: false } }),
        M('TeamMember').deleteMany({ provider: providerId }),
        M('Availability').deleteMany({ provider: providerId }),
        M('StaffAvailability').deleteMany({ provider: providerId }),
        M('Shift').deleteMany({ provider: providerId }),
        M('TimeOff').deleteMany({ provider: providerId }),
        M('BlockedTime').deleteMany({ provider: providerId }),
        M('Category').deleteMany({ provider: providerId }),
        M('WaitingList').deleteMany({ provider: providerId }),
        M('ClientNote').deleteMany({ provider: providerId }),
        M('TimeClock').deleteMany({ provider: providerId }),
        M('User').updateMany({ favorites: providerId }, { $pull: { favorites: providerId } }),
        // The business's staff logins go with it.
        M('User').deleteMany({ _id: { $in: staff.map((s) => s._id) } }),
    ]);
    return { cancelled, staffRemoved: staff.length };
}

async function keepClientNameOnBookings(user) {
    const Appointment = load('Appointment');
    const now = new Date();
    const name = String(user.name || '').trim() || 'Deleted client';
    // Name first (only where the row has none of its own), then unlink the account.
    // updateMany skips the "needs a customer, guest or walk-in" validator, so the
    // order matters only for readability: both run before the account is gone.
    const named = await Appointment.updateMany(
        { customer: user._id, $or: [{ walkInName: null }, { walkInName: '' }] },
        { $set: { walkInName: name } },
    );
    await Appointment.updateMany(
        { customer: user._id },
        { $set: { customer: null, clientAccountDeletedAt: now } },
    );
    ['Notification', 'PushSubscription', 'WaitingList'].forEach(load);
    await Promise.all([
        M('Notification').deleteMany({ user: user._id }),
        M('PushSubscription').deleteMany({ user: user._id }),
        M('WaitingList').deleteMany({ customer: user._id }),
    ]);
    return { bookingsKept: named.modifiedCount || 0 };
}

module.exports = { removeBusinessData, keepClientNameOnBookings, REMOVED_REASON };

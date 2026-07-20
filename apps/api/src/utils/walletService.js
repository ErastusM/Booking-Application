const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');

/**
 * Wallet money movement — the ONLY place balances change.
 *
 * Single-node Mongo has no multi-document transactions, so correctness comes
 * from atomic conditional updates ($inc / aggregation-pipeline $max guarded by a
 * balance condition) rather than read-modify-write. Every mutation also writes a
 * WalletTransaction audit row with the before/after balances.
 *
 * Reservations are tracked by linking the reservation row to an appointment;
 * releasing or completing a booking finds that row, so those operations are
 * idempotent (safe to call again on a repeated status change).
 */

const snap = (w) => ({ total: w ? w.totalBalance : null, reserved: w ? w.reservedBalance : null });

const getOrCreateWallet = async (customer, provider) => {
    let wallet = await Wallet.findOne({ customer, provider });
    if (!wallet) {
        try {
            wallet = await Wallet.create({ customer, provider });
        } catch (err) {
            // Lost a create race against a concurrent request — just load it.
            wallet = await Wallet.findOne({ customer, provider });
        }
    }
    return wallet;
};

/**
 * Reserve `amount` against a booking. Atomic: only succeeds if available
 * (total − reserved) covers it, so two concurrent bookings can't oversell.
 * Returns { ok, wallet, transaction } or { ok:false, reason }.
 */
const reserveFunds = async ({ customer, provider, amount, appointmentId, initiatedBy }) => {
    if (!(amount > 0)) return { ok: true, wallet: null, transaction: null }; // nothing to reserve
    const wallet = await getOrCreateWallet(customer, provider);
    const before = snap(wallet);

    const updated = await Wallet.findOneAndUpdate(
        {
            _id: wallet._id,
            $expr: { $gte: [{ $subtract: ['$totalBalance', '$reservedBalance'] }, amount] },
        },
        { $inc: { reservedBalance: amount } },
        { new: true }
    );
    if (!updated) return { ok: false, reason: 'insufficient_balance', wallet };

    const transaction = await WalletTransaction.create({
        wallet: wallet._id, customer, provider,
        type: 'reservation', status: 'reserved', direction: 'reserve', amount,
        appointment: appointmentId || null,
        balanceBefore: before, balanceAfter: snap(updated),
        initiatedBy: initiatedBy || customer,
    });
    return { ok: true, wallet: updated, transaction };
};

/**
 * Release a booking's reservation back to available. Idempotent — if no live
 * reservation exists for the appointment (already released/deducted), no-op.
 */
const releaseReservation = async ({ appointmentId, resolvedBy }) => {
    if (!appointmentId) return { ok: true, released: 0 };
    const reservation = await WalletTransaction.findOne({
        appointment: appointmentId, type: 'reservation', status: 'reserved',
    });
    if (!reservation) return { ok: true, released: 0 };

    const wallet = await Wallet.findById(reservation.wallet);
    if (!wallet) return { ok: true, released: 0 };
    const before = snap(wallet);

    // Clamp at zero so a double-release can never drive reserved negative.
    const updated = await Wallet.findByIdAndUpdate(
        wallet._id,
        [{ $set: { reservedBalance: { $max: [0, { $subtract: ['$reservedBalance', reservation.amount] }] } } }],
        { new: true }
    );

    reservation.status = 'released';
    reservation.resolvedBy = resolvedBy || null;
    reservation.resolvedAt = new Date();
    await reservation.save();

    await WalletTransaction.create({
        wallet: wallet._id, customer: reservation.customer, provider: reservation.provider,
        type: 'reservation', status: 'released', direction: 'release', amount: reservation.amount,
        appointment: appointmentId,
        balanceBefore: before, balanceAfter: snap(updated),
        initiatedBy: resolvedBy || null,
        reason: 'Reservation released',
    });
    return { ok: true, released: reservation.amount, wallet: updated };
};

/**
 * Complete a booking: turn its reservation into a permanent deduction (reduce
 * both reserved and total). Idempotent via the live-reservation lookup.
 */
const deductForCompletion = async ({ appointmentId, resolvedBy }) => {
    if (!appointmentId) return { ok: true, deducted: 0 };
    const reservation = await WalletTransaction.findOne({
        appointment: appointmentId, type: 'reservation', status: 'reserved',
    });
    if (!reservation) return { ok: true, deducted: 0 };

    const wallet = await Wallet.findById(reservation.wallet);
    if (!wallet) return { ok: true, deducted: 0 };
    const before = snap(wallet);
    const amount = reservation.amount;

    const updated = await Wallet.findByIdAndUpdate(
        wallet._id,
        [{ $set: {
            totalBalance: { $max: [0, { $subtract: ['$totalBalance', amount] }] },
            reservedBalance: { $max: [0, { $subtract: ['$reservedBalance', amount] }] },
        } }],
        { new: true }
    );

    reservation.status = 'completed';
    reservation.resolvedBy = resolvedBy || null;
    reservation.resolvedAt = new Date();
    await reservation.save();

    const transaction = await WalletTransaction.create({
        wallet: wallet._id, customer: reservation.customer, provider: reservation.provider,
        type: 'deduction', status: 'completed', direction: 'debit', amount,
        appointment: appointmentId,
        balanceBefore: before, balanceAfter: snap(updated),
        initiatedBy: resolvedBy || null,
        reason: 'Service completed',
    });
    return { ok: true, deducted: amount, wallet: updated, transaction };
};

/**
 * Adjust a live reservation to a new amount — e.g. the booking's service was
 * swapped for a cheaper/dearer one (spec §8). The difference is reserved or
 * released atomically; a debit increase that can't be covered is refused.
 * Idempotent-friendly: no live reservation → no-op. Ready to call from a future
 * "change service on an existing booking" flow.
 */
const adjustReservation = async ({ appointmentId, newAmount, resolvedBy }) => {
    if (!appointmentId || !(newAmount >= 0)) return { ok: true, delta: 0 };
    const reservation = await WalletTransaction.findOne({
        appointment: appointmentId, type: 'reservation', status: 'reserved',
    });
    if (!reservation) return { ok: true, delta: 0 };
    const delta = newAmount - reservation.amount;
    if (delta === 0) return { ok: true, delta: 0 };

    const wallet = await Wallet.findById(reservation.wallet);
    if (!wallet) return { ok: true, delta: 0 };
    const before = snap(wallet);
    let updated;

    if (delta > 0) {
        updated = await Wallet.findOneAndUpdate(
            { _id: wallet._id, $expr: { $gte: [{ $subtract: ['$totalBalance', '$reservedBalance'] }, delta] } },
            { $inc: { reservedBalance: delta } },
            { new: true }
        );
        if (!updated) return { ok: false, reason: 'insufficient_balance' };
    } else {
        updated = await Wallet.findByIdAndUpdate(
            wallet._id,
            [{ $set: { reservedBalance: { $max: [0, { $add: ['$reservedBalance', delta] }] } } }],
            { new: true }
        );
    }

    reservation.amount = newAmount; // later release/deduction follows the new amount
    await reservation.save();

    await WalletTransaction.create({
        wallet: wallet._id, customer: reservation.customer, provider: reservation.provider,
        type: 'reservation', status: 'reserved', direction: delta > 0 ? 'reserve' : 'release', amount: Math.abs(delta),
        appointment: appointmentId, balanceBefore: before, balanceAfter: snap(updated),
        initiatedBy: resolvedBy || null, reason: 'Reservation adjusted (service changed)',
    });
    return { ok: true, delta };
};

/** Client submits a top-up request (no balance change until a provider approves). */
const createTopUp = async ({ customer, provider, amount, reference, proofUrl, method }) => {
    const wallet = await getOrCreateWallet(customer, provider);
    return WalletTransaction.create({
        wallet: wallet._id, customer, provider,
        type: 'topup', status: 'pending', direction: 'credit', amount,
        reference: reference || '', proofUrl: proofUrl || '', method: method || 'manual',
        initiatedBy: customer,
    });
};

/** Provider approves a pending top-up → credit total balance. */
// Allocate a pending top-up → credit total balance. The approver is the wallet's
// provider OR an admin (providerId omitted means an admin is allocating).
const approveTopUp = async ({ transactionId, providerId, resolvedBy }) => {
    const query = { _id: transactionId, type: 'topup', status: 'pending' };
    if (providerId) query.provider = providerId;
    // Atomically CLAIM the pending top-up by flipping its status. A top-up is
    // approvable from two endpoints (provider + admin) and a double-click, so a
    // read-check-then-$inc let two approvals both credit the balance — doubling
    // real money with only one ledger row. Now the status flip is the gate: only
    // the racer whose findOneAndUpdate matches `status:'pending'` proceeds; the
    // loser gets null and credits nothing.
    const txn = await WalletTransaction.findOneAndUpdate(
        query,
        { $set: { status: 'approved', resolvedBy: resolvedBy || providerId || null, resolvedAt: new Date() } },
        { new: true }
    );
    if (!txn) {
        const exists = await WalletTransaction.exists({ _id: transactionId, type: 'topup' });
        return { ok: false, reason: exists ? 'already_resolved' : 'not_found' };
    }

    const wallet = await Wallet.findById(txn.wallet);
    const before = snap(wallet);
    const updated = await Wallet.findByIdAndUpdate(wallet._id, { $inc: { totalBalance: txn.amount } }, { new: true });

    txn.balanceBefore = before;
    txn.balanceAfter = snap(updated);
    await txn.save();
    return { ok: true, transaction: txn, wallet: updated };
};

/** Reject a pending top-up → no balance change (provider or admin). */
const rejectTopUp = async ({ transactionId, providerId, resolvedBy, reason }) => {
    const query = { _id: transactionId, type: 'topup' };
    if (providerId) query.provider = providerId;
    const txn = await WalletTransaction.findOne(query);
    if (!txn) return { ok: false, reason: 'not_found' };
    if (txn.status !== 'pending') return { ok: false, reason: 'already_resolved' };
    txn.status = 'rejected';
    txn.reason = reason || txn.reason;
    txn.resolvedBy = resolvedBy || providerId || null;
    txn.resolvedAt = new Date();
    await txn.save();
    return { ok: true, transaction: txn };
};

/**
 * Provider proposes a manual credit/debit (or refund). Stored pending — it
 * changes nothing until the client approves it (providers can't force changes).
 */
const createAdjustment = async ({ provider, customer, amount, direction, reason, isRefund }) => {
    const wallet = await getOrCreateWallet(customer, provider);
    return WalletTransaction.create({
        wallet: wallet._id, customer, provider,
        type: isRefund ? 'refund' : 'adjustment', status: 'pending', direction, amount,
        reason: reason || '',
        initiatedBy: provider,
    });
};

/** Client approves a pending adjustment → apply credit or debit. */
const approveAdjustment = async ({ transactionId, customerId }) => {
    // Atomically CLAIM the pending adjustment so two concurrent approvals (or a
    // double-click by the beneficiary) can't both apply it. The balance predicate
    // on the debit branch below only guards OVERDRAFT, not double-apply — so
    // without this gate both a credit AND a debit could be applied twice. The
    // status flip is the single-winner gate for both directions.
    const txn = await WalletTransaction.findOneAndUpdate(
        { _id: transactionId, customer: customerId, type: { $in: ['adjustment', 'refund'] }, status: 'pending' },
        { $set: { status: 'approved', resolvedBy: customerId, resolvedAt: new Date() } },
        { new: true }
    );
    if (!txn) {
        const exists = await WalletTransaction.exists({
            _id: transactionId, customer: customerId, type: { $in: ['adjustment', 'refund'] },
        });
        return { ok: false, reason: exists ? 'already_resolved' : 'not_found' };
    }

    const wallet = await Wallet.findById(txn.wallet);
    const before = snap(wallet);
    let updated;

    if (txn.direction === 'credit') {
        updated = await Wallet.findByIdAndUpdate(wallet._id, { $inc: { totalBalance: txn.amount } }, { new: true });
    } else {
        // Debit can't dip into reserved funds: require enough AVAILABLE balance.
        updated = await Wallet.findOneAndUpdate(
            { _id: wallet._id, $expr: { $gte: [{ $subtract: ['$totalBalance', '$reservedBalance'] }, txn.amount] } },
            { $inc: { totalBalance: -txn.amount } },
            { new: true }
        );
        if (!updated) {
            // Roll the claim back to pending so the client can retry once funded.
            txn.status = 'pending';
            txn.resolvedBy = null;
            txn.resolvedAt = null;
            await txn.save();
            return { ok: false, reason: 'insufficient_balance' };
        }
    }

    txn.balanceBefore = before;
    txn.balanceAfter = snap(updated);
    await txn.save();
    return { ok: true, transaction: txn, wallet: updated };
};

/** Client rejects a pending adjustment → no balance change. */
const rejectAdjustment = async ({ transactionId, customerId }) => {
    const txn = await WalletTransaction.findOne({
        _id: transactionId, customer: customerId, type: { $in: ['adjustment', 'refund'] },
    });
    if (!txn) return { ok: false, reason: 'not_found' };
    if (txn.status !== 'pending') return { ok: false, reason: 'already_resolved' };
    txn.status = 'rejected';
    txn.resolvedBy = customerId;
    txn.resolvedAt = new Date();
    await txn.save();
    return { ok: true, transaction: txn };
};

module.exports = {
    getOrCreateWallet,
    reserveFunds,
    releaseReservation,
    deductForCompletion,
    adjustReservation,
    createTopUp,
    approveTopUp,
    rejectTopUp,
    createAdjustment,
    approveAdjustment,
    rejectAdjustment,
};

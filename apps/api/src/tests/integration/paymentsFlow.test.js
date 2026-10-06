/**
 * Online booking payments (PAYMENTS_ENABLED, PayGate PayHost hosted page) end
 * to end, with PayGate replaced by a fake transport:
 *   booking → payment hold → notify/return → Query → confirmed + ledger credit;
 *   idempotency, checksum and mismatch defences, declined + retry, the hold
 *   sweeper (release + late approval), cancellations and refunds.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendStaffBookingAlert: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
    sendWaitlistPromotion: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const emailService = require('../../utils/emailService');
const Appointment = require('../../models/Appointment');
const Payment = require('../../models/Payment');
const LedgerEntry = require('../../models/LedgerEntry');
const Notification = require('../../models/Notification');
const payments = require('../../services/paymentService');
const { makeProvider, makeUser, makeService, authHeader } = require('../helpers/factories');
const { futureDate } = require('../helpers/dates');
const { createFakePaygate } = require('../helpers/fakePaygate');

const gw = createFakePaygate();
const tick = () => new Promise((r) => setTimeout(r, 60));

beforeAll(async () => { gw.install(); await testDb.connect(); });
afterAll(async () => { gw.uninstall(); await testDb.closeDatabase(); });
afterEach(async () => { gw.reset(); jest.clearAllMocks(); await testDb.clearDatabase(); });

const setup = async ({ mode = 'full', depositType = 'percent', depositValue = null, currency = 'NAD', price = 200 } = {}) => {
    const provider = await makeProvider({
        businessProfile: { businessName: 'Vibe Cuts', currency },
        paymentSettings: { mode, depositType, depositValue },
    });
    const service = await makeService(provider._id, { name: 'Taper Fade', price, duration: 30 });
    return { provider, service };
};

const bookAsGuest = (service, { date = futureDate(0), start = '10:00', end = '10:30', name = 'Ana Shilongo', email = 'ana@example.com' } = {}) => request(app)
    .post('/api/appointments')
    .send({ service: service._id, appointmentDate: date, startTime: start, endTime: end, guestName: name, guestEmail: email });

const notify = (body) => request(app).post('/api/payments/paygate/notify').type('form').send(body);
const ledgerSum = async (providerId) => payments.balanceOf(providerId);

describe('booking with online payment', () => {
    it('full price: the booking is held as pending_payment and a PayGate session comes back', async () => {
        const { provider, service } = await setup({ mode: 'full', price: 200 });
        const res = await bookAsGuest(service);
        expect(res.status).toBe(201);
        expect(res.body.code).toBe('payment_required');
        expect(res.body.data.status).toBe('pending_payment');
        expect(res.body.data.amountDueOnlineCents).toBe(20000);
        expect(res.body.data.paymentKind).toBe('full');
        expect(res.body.data.currency).toBe('NAD');
        expect(new Date(res.body.data.paymentHoldExpiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
        const p = res.body.payment;
        expect(p).toMatchObject({ kind: 'full', amountCents: 20000, currency: 'NAD', method: 'POST', redirectUrl: 'https://secure.paygate.co.za/payweb3/process.trans' });
        expect(p.reference).toMatch(/^BP[0-9A-F]{30}$/);
        expect(Object.keys(p.fields)).toEqual(['PAYGATE_ID', 'PAY_REQUEST_ID', 'REFERENCE', 'CHECKSUM']);
        // The session request asked PayGate for exactly this, in cents, in NAD.
        const init = gw.calls.find((c) => c.soapAction === 'WebPaymentRequest');
        expect(init.body).toContain('<Amount>20000</Amount>');
        expect(init.body).toContain('<Currency>NAD</Currency>');
        expect(init.body).toContain('/api/payments/paygate/notify</NotifyUrl>');

        const payment = await Payment.findOne({ reference: p.reference });
        expect(payment).toMatchObject({ status: 'initiated', amountCents: 20000, kind: 'full', guestEmail: 'ana@example.com' });
        expect(payment.payRequestId).toBe(p.fields.PAY_REQUEST_ID);

        // Not a booking for the business yet: no alert, no email, not on the calendar.
        await tick();
        expect(emailService.sendAppointmentConfirmed).not.toHaveBeenCalled();
        expect(await Notification.countDocuments({ user: provider._id })).toBe(0);
        const list = await request(app).get('/api/appointments?all=true').set(authHeader(provider));
        expect(list.body.data).toHaveLength(0);
        const awaiting = await request(app).get('/api/appointments?all=true&status=pending_payment').set(authHeader(provider));
        expect(awaiting.body.data).toHaveLength(1);
        const summary = await request(app).get('/api/appointments/summary').set(authHeader(provider));
        expect(summary.body.data.total).toBe(0);

        // ...but it holds the slot.
        const second = await bookAsGuest(service, { name: 'Ben Iipinge', email: 'ben@example.com' });
        expect(second.status).toBe(409);
    });

    it('deposit: a percent of the price, or a fixed amount capped at the price', async () => {
        const { service } = await setup({ mode: 'deposit', depositType: 'percent', depositValue: 25, price: 199.99 });
        const res = await bookAsGuest(service);
        expect(res.status).toBe(201);
        expect(res.body.payment).toMatchObject({ kind: 'deposit', amountCents: 5000 });

        const fixed = await setup({ mode: 'deposit', depositType: 'fixed', depositValue: 50000, price: 200 });
        const res2 = await bookAsGuest(fixed.service, { start: '11:00', end: '11:30' });
        expect(res2.body.payment).toMatchObject({ kind: 'deposit', amountCents: 20000 });
    });

    it('a business that does not price in NAD is not offered online payment — booking as before', async () => {
        const { service } = await setup({ mode: 'full', currency: 'ZAR' });
        const res = await bookAsGuest(service);
        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe('confirmed');
        expect(res.body.payment).toBeUndefined();
        expect(await Payment.countDocuments()).toBe(0);
    });

    it('the owner logging a walk-in is never asked to pay online', async () => {
        const { provider, service } = await setup({ mode: 'full' });
        const res = await request(app).post('/api/appointments').set(authHeader(provider))
            .send({ service: service._id, appointmentDate: futureDate(0), startTime: '10:00', endTime: '10:30', walkInName: 'Walk In' });
        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe('confirmed');
        expect(res.body.payment).toBeUndefined();
    });

    it('a recurring booking at a business that takes payment online is refused clearly', async () => {
        const { service } = await setup({ mode: 'full' });
        const client = await makeUser({ name: 'Cara Nghipandulwa' });
        const res = await request(app).post('/api/appointments').set(authHeader(client)).send({
            service: service._id, appointmentDate: futureDate(0), startTime: '10:00', endTime: '10:30', isRecurring: true, recurrenceType: 'weekly',
        });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('online_payment_recurring_unsupported');
        expect(await Appointment.countDocuments()).toBe(0);
    });

    it('PayGate unreachable: 502, and the hold is released (no orphan booking)', async () => {
        const { service } = await setup({ mode: 'full' });
        gw.initFail = true;
        const res = await bookAsGuest(service);
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('payment_unavailable');
        expect(await Appointment.countDocuments()).toBe(0);
        expect(await Payment.countDocuments({ status: 'failed' })).toBe(1);
        gw.initFail = false;
        expect((await bookAsGuest(service)).status).toBe(201);
    });
});

describe('PayGate notify / return', () => {
    it('approved notify → confirmed booking, ledger credit, usual notices; a duplicate notify changes nothing', async () => {
        const { provider, service } = await setup({ mode: 'full', price: 200 });
        const res = await bookAsGuest(service);
        const ref = res.body.payment.reference;
        gw.setStatus(ref, 1);

        const n1 = await notify(gw.notifyBody(ref));
        expect(n1.status).toBe(200);
        expect(n1.text).toBe('OK');

        const appt = await Appointment.findById(res.body.data._id);
        expect(appt.status).toBe('confirmed');
        expect(appt.amountPaidOnlineCents).toBe(20000);
        expect(appt.paymentStatus).toBe('paid');
        expect(appt.paymentHoldExpiresAt).toBeUndefined();
        const payment = await Payment.findOne({ reference: ref });
        expect(payment.status).toBe('paid');
        expect(payment.transactionId).toBeTruthy();
        expect(payment.lastNotify).toMatchObject({ TRANSACTION_STATUS: '1', PAY_METHOD_DETAIL: 'Visa' });
        expect(payment.lastNotify.CHECKSUM).toBeUndefined();
        expect(await ledgerSum(provider._id)).toBe(20000);

        await tick();
        expect(emailService.sendAppointmentConfirmed).toHaveBeenCalledTimes(1);
        expect(emailService.sendAppointmentConfirmed.mock.calls[0][0]).toBe('ana@example.com');
        expect(await Notification.countDocuments({ user: provider._id })).toBe(1);

        // Duplicate (PayGate retries) and a racing return: no second credit or email.
        await notify(gw.notifyBody(ref));
        await Promise.all([notify(gw.notifyBody(ref)), request(app).post('/api/payments/paygate/return').type('form').send(gw.returnBody(ref))]);
        await tick();
        expect(await LedgerEntry.countDocuments({ provider: provider._id })).toBe(1);
        expect(await ledgerSum(provider._id)).toBe(20000);
        expect(emailService.sendAppointmentConfirmed).toHaveBeenCalledTimes(1);
        expect(await Notification.countDocuments({ user: provider._id })).toBe(1);

        // Now it's on the business's calendar.
        const list = await request(app).get('/api/appointments?all=true').set(authHeader(provider));
        expect(list.body.data).toHaveLength(1);
    });

    it('a notify with a bad checksum is rejected (400) and changes nothing', async () => {
        const { provider, service } = await setup();
        const res = await bookAsGuest(service);
        const ref = res.body.payment.reference;
        gw.setStatus(ref, 1);
        expect((await notify(gw.notifyBody(ref, { checksumKey: 'wrong' }))).status).toBe(400);
        expect((await notify(gw.notifyBody(ref, { tamper: true }))).status).toBe(400);
        expect((await Payment.findOne({ reference: ref })).status).toBe('initiated');
        expect((await Appointment.findById(res.body.data._id)).status).toBe('pending_payment');
        expect(await ledgerSum(provider._id)).toBe(0);
    });

    it('the notify only triggers a Query: if PayGate says declined, nothing is confirmed whatever was posted', async () => {
        const { provider, service } = await setup();
        const res = await bookAsGuest(service);
        const ref = res.body.payment.reference;
        gw.setStatus(ref, 2);
        // The post claims "approved"; the Query (the truth) says declined.
        const body = gw.notifyBody(ref, { status: 1 });
        expect((await notify(body)).status).toBe(200);
        const payment = await Payment.findOne({ reference: ref });
        expect(payment.status).toBe('failed');
        expect((await Appointment.findById(res.body.data._id)).status).toBe('pending_payment');
        expect(await ledgerSum(provider._id)).toBe(0);

        // The client can try again while the slot is still held.
        const status = await request(app).get(`/api/payments/${ref}/status`);
        expect(status.body.data).toMatchObject({ status: 'failed', canRetry: true });
        const retry = await request(app).post(`/api/payments/${ref}/retry`);
        expect(retry.status).toBe(201);
        expect(retry.body.payment.reference).not.toBe(ref);
        expect(retry.body.payment.amountCents).toBe(20000);
        gw.setStatus(retry.body.payment.reference, 1);
        await notify(gw.notifyBody(retry.body.payment.reference));
        expect((await Appointment.findById(res.body.data._id)).status).toBe('confirmed');
        expect(await ledgerSum(provider._id)).toBe(20000);
    });

    it('approved but the amount (or currency) does not match → not confirmed, flagged for review', async () => {
        const { provider, service } = await setup();
        const res = await bookAsGuest(service);
        const ref = res.body.payment.reference;
        gw.setStatus(ref, 1, { amountOverride: 100 });
        await notify(gw.notifyBody(ref));
        let payment = await Payment.findOne({ reference: ref });
        expect(payment.status).toBe('initiated');
        expect(payment.flagged).toBe(true);
        expect(payment.flagReason).toMatch(/amount/);
        expect((await Appointment.findById(res.body.data._id)).status).toBe('pending_payment');
        expect(await ledgerSum(provider._id)).toBe(0);

        gw.setStatus(ref, 1, { amountOverride: undefined, currencyOverride: 'ZAR' });
        await notify(gw.notifyBody(ref));
        payment = await Payment.findOne({ reference: ref });
        expect(payment.status).toBe('initiated');
        expect(payment.flagReason).toMatch(/currency/);
    });

    it('return: verifies, queries, and 303-redirects to our own result page only', async () => {
        const { service } = await setup();
        const res = await bookAsGuest(service);
        const ref = res.body.payment.reference;
        gw.setStatus(ref, 1);
        const r = await request(app).post('/api/payments/paygate/return').set('Origin', 'https://secure.paygate.co.za')
            .type('form').send(`${gw.returnBody(ref)}&RETURN_URL=https%3A%2F%2Fevil.example`);
        expect(r.status).toBe(303);
        expect(r.headers.location).toBe(`http://localhost:3001/booking/payment?ref=${ref}`);
        expect((await Appointment.findById(res.body.data._id)).status).toBe('confirmed');

        // Unknown payment → still our page, no reference.
        const unknown = await request(app).post('/api/payments/paygate/return').type('form').send('PAY_REQUEST_ID=nope&TRANSACTION_STATUS=1&CHECKSUM=x');
        expect(unknown.status).toBe(303);
        expect(unknown.headers.location).toBe('http://localhost:3001/booking/payment?ref=');
    });

    it('the public status page shows only what the result page needs, and asks PayGate itself', async () => {
        const { service } = await setup();
        const res = await bookAsGuest(service);
        const ref = res.body.payment.reference;
        gw.setStatus(ref, 1);
        const s = await request(app).get(`/api/payments/${ref}/status`);
        expect(s.status).toBe(200);
        expect(s.body.data).toMatchObject({ status: 'paid', amountCents: 20000, currency: 'NAD', kind: 'full', canRetry: false });
        expect(s.body.data.appointment).toMatchObject({ status: 'confirmed', service: 'Taper Fade', business: 'Vibe Cuts', startTime: '10:00' });
        expect(JSON.stringify(s.body)).not.toMatch(/ana@example.com|Shilongo/);
        expect((await request(app).get('/api/payments/BP000000000000000000000000000000/status')).status).toBe(404);
        expect((await request(app).get('/api/payments/not-a-ref/status')).status).toBe(404);
    });
});

describe('payment hold sweeper', () => {
    const expireHold = (id) => Appointment.updateOne({ _id: id }, { $set: { paymentHoldExpiresAt: new Date(Date.now() - 60 * 1000) } });

    it('an unpaid hold past its time is released: booking cancelled (payment_timeout), payment expired, slot bookable again', async () => {
        const { provider, service } = await setup();
        const res = await bookAsGuest(service);
        const ref = res.body.payment.reference;
        await expireHold(res.body.data._id);

        const r = await payments.sweepExpiredHolds();
        expect(r.released).toBe(1);
        const appt = await Appointment.findById(res.body.data._id);
        expect(appt.status).toBe('cancelled');
        expect(appt.cancellationReason).toBe('payment_timeout');
        expect((await Payment.findOne({ reference: ref })).status).toBe('expired');
        // Nobody at the business is told about a booking they never had.
        await tick();
        expect(await Notification.countDocuments({ user: provider._id })).toBe(0);
        expect(emailService.sendAppointmentCancelled).not.toHaveBeenCalled();
        // Hidden from the business's calendar even as a cancellation.
        const list = await request(app).get('/api/appointments?all=true').set(authHeader(provider));
        expect(list.body.data).toHaveLength(0);

        const again = await bookAsGuest(service, { name: 'Ben Iipinge', email: 'ben@example.com' });
        expect(again.status).toBe(201);

        // A second sweep has nothing to do.
        expect((await payments.sweepExpiredHolds()).released).toBe(0);
        // The status page says it ran out.
        const s = await request(app).get(`/api/payments/${ref}/status`);
        expect(s.body.data).toMatchObject({ status: 'expired', canRetry: false });
        expect((await request(app).post(`/api/payments/${ref}/retry`)).status).toBe(409);
    });

    it('a late approval found during the sweep wins: the booking is confirmed, not released', async () => {
        const { provider, service } = await setup();
        const res = await bookAsGuest(service);
        gw.setStatus(res.body.payment.reference, 1);
        await expireHold(res.body.data._id);
        const r = await payments.sweepExpiredHolds();
        expect(r).toMatchObject({ released: 0, confirmed: 1 });
        expect((await Appointment.findById(res.body.data._id)).status).toBe('confirmed');
        expect(await ledgerSum(provider._id)).toBe(20000);
    });

    it('money that arrives after the hold was released goes straight back to the client', async () => {
        const { provider, service } = await setup();
        const res = await bookAsGuest(service);
        const ref = res.body.payment.reference;
        await expireHold(res.body.data._id);
        await payments.sweepExpiredHolds();
        gw.setStatus(ref, 1);
        await notify(gw.notifyBody(ref));
        const payment = await Payment.findOne({ reference: ref });
        expect(payment.status).toBe('refunded');
        expect(payment.refunds[0]).toMatchObject({ trigger: 'booking_released', gatewayStatus: 'done', amountCents: 20000 });
        expect((await Appointment.findById(res.body.data._id)).status).toBe('cancelled');
        expect(await ledgerSum(provider._id)).toBe(0);
    });
});

describe('cancellations and refunds', () => {
    const payFor = async (res) => {
        gw.setStatus(res.body.payment.reference, 1);
        await notify(gw.notifyBody(res.body.payment.reference));
        return Payment.findOne({ reference: res.body.payment.reference });
    };

    it('the business cancels a paid booking → full refund and a ledger debit', async () => {
        const { provider, service } = await setup({ mode: 'deposit', depositType: 'percent', depositValue: 50 });
        const res = await bookAsGuest(service);
        await payFor(res);
        expect(await ledgerSum(provider._id)).toBe(10000);

        const c = await request(app).put(`/api/appointments/${res.body.data._id}/status`).set(authHeader(provider)).send({ status: 'cancelled' });
        expect(c.status).toBe(200);
        const payment = await Payment.findOne({ reference: res.body.payment.reference });
        expect(payment.status).toBe('refunded');
        expect(payment.refundedCents).toBe(10000);
        expect(payment.refunds[0]).toMatchObject({ trigger: 'business_cancelled', gatewayStatus: 'done' });
        expect(gw.calls.filter((x) => x.body.includes('<RefundRequest>'))).toHaveLength(1);
        expect(await ledgerSum(provider._id)).toBe(0);
        expect(await LedgerEntry.countDocuments({ type: 'refund', amountCents: -10000 })).toBe(1);
        const appt = await Appointment.findById(res.body.data._id);
        expect(appt.amountRefundedOnlineCents).toBe(10000);
    });

    it('the business cannot confirm a booking that is waiting for payment by hand; it may turn it down', async () => {
        const { provider, service } = await setup();
        const res = await bookAsGuest(service);
        const confirm = await request(app).put(`/api/appointments/${res.body.data._id}/status`).set(authHeader(provider)).send({ status: 'confirmed' });
        expect(confirm.status).toBe(409);
        expect(confirm.body.code).toBe('awaiting_payment');
        const cancel = await request(app).put(`/api/appointments/${res.body.data._id}/status`).set(authHeader(provider)).send({ status: 'cancelled' });
        expect(cancel.status).toBe(200);
        expect((await Payment.findOne({ reference: res.body.payment.reference })).status).toBe('cancelled');
    });

    it('the client cancels in time → full refund; through the manage link too', async () => {
        const { provider, service } = await setup();
        const client = await makeUser({ name: 'Cara Nghipandulwa', email: 'cara@example.com' });
        const res = await request(app).post('/api/appointments').set(authHeader(client))
            .send({ service: service._id, appointmentDate: futureDate(0), startTime: '10:00', endTime: '10:30' });
        expect(res.status).toBe(201);
        const payment = await payFor(res);
        expect(payment.customer.toString()).toBe(client._id.toString());

        const del = await request(app).delete(`/api/appointments/${res.body.data._id}`).set(authHeader(client)).send({});
        expect(del.status).toBe(200);
        const after = await Payment.findById(payment._id);
        expect(after.status).toBe('refunded');
        expect(after.refunds[0].trigger).toBe('client_cancelled');
        expect(await ledgerSum(provider._id)).toBe(0);

        // Guest, via the no-login manage link.
        const g = await bookAsGuest(service, { start: '12:00', end: '12:30' });
        await payFor(g);
        const token = (await Appointment.findById(g.body.data._id)).manageToken;
        const manage = await request(app).get(`/api/appointments/manage/${token}`);
        expect(manage.body.data.onlinePayment).toMatchObject({ kind: 'full', amountPaidOnlineCents: 20000 });
        expect((await request(app).post(`/api/appointments/manage/${token}/cancel`)).status).toBe(200);
        expect((await Payment.findOne({ reference: g.body.payment.reference })).status).toBe('refunded');
    });

    it('after the business’s cancellation deadline the client cannot cancel, and nothing is refunded', async () => {
        const { provider, service } = await setup();
        provider.bookingPolicy = { cancellationWindowHours: 168 };
        await provider.save();
        const client = await makeUser({ name: 'Dan Haufiku' });
        const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
        const ymd = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
        const res = await request(app).post('/api/appointments').set(authHeader(client))
            .send({ service: service._id, appointmentDate: ymd, startTime: '10:00', endTime: '10:30' });
        expect(res.status).toBe(201);
        const payment = await payFor(res);
        const del = await request(app).delete(`/api/appointments/${res.body.data._id}`).set(authHeader(client)).send({});
        expect(del.status).toBe(400);
        expect((await Payment.findById(payment._id)).status).toBe('paid');
        expect(gw.calls.some((x) => x.body.includes('<RefundRequest>'))).toBe(false);
        expect(await ledgerSum(provider._id)).toBe(20000);
        // The rule itself: a client cancellation outside the window refunds nothing.
        await payments.onAppointmentCancelled(res.body.data._id, { actor: 'client', withinWindow: false });
        expect((await Payment.findById(payment._id)).refunds).toHaveLength(0);
    });

    it('the client abandons a booking before paying: hold released, nobody at the business told', async () => {
        const { provider, service } = await setup();
        const client = await makeUser({ name: 'Eve Amupolo' });
        const res = await request(app).post('/api/appointments').set(authHeader(client))
            .send({ service: service._id, appointmentDate: futureDate(0), startTime: '10:00', endTime: '10:30' });
        const del = await request(app).delete(`/api/appointments/${res.body.data._id}`).set(authHeader(client)).send({});
        expect(del.status).toBe(200);
        expect((await Appointment.findById(res.body.data._id)).cancellationReason).toBe('payment_abandoned');
        expect((await Payment.findOne({ reference: res.body.payment.reference })).status).toBe('cancelled');
        await tick();
        expect(await Notification.countDocuments({ user: provider._id })).toBe(0);
    });

    it('a refund PayGate refuses is kept as refund_pending (cancellation stands) and can be retried', async () => {
        const { provider, service } = await setup();
        const res = await bookAsGuest(service);
        await payFor(res);
        gw.refundFail = true;
        const c = await request(app).put(`/api/appointments/${res.body.data._id}/status`).set(authHeader(provider)).send({ status: 'cancelled' });
        expect(c.status).toBe(200);
        expect((await Appointment.findById(res.body.data._id)).status).toBe('cancelled');
        let payment = await Payment.findOne({ reference: res.body.payment.reference });
        expect(payment.status).toBe('refund_pending');
        expect(payment.refundingCents).toBe(20000);
        expect(payment.refunds[0]).toMatchObject({ gatewayStatus: 'failed' });
        expect(payment.refunds[0].error).toMatch(/Refund not possible/);
        expect(await ledgerSum(provider._id)).toBe(20000);

        // The owner sees it, and no second refund can be stacked on top of the reserved one.
        const mine = await request(app).get('/api/payments/me/payments').set(authHeader(provider));
        expect(mine.body.data[0]).toMatchObject({ status: 'refund_pending', refundableCents: 0 });
        const extra = await request(app).post(`/api/payments/${payment._id}/refund`).set(authHeader(provider)).send({ amountCents: 100 });
        expect(extra.status).toBe(409);

        gw.refundFail = false;
        const retry = await request(app).post(`/api/payments/${payment._id}/refunds/${payment.refunds[0]._id}/retry`).set(authHeader(provider));
        expect(retry.status).toBe(200);
        payment = await Payment.findById(payment._id);
        expect(payment.status).toBe('refunded');
        expect(payment.refundingCents).toBe(0);
        expect(await ledgerSum(provider._id)).toBe(0);
        // Retrying a done refund is a no-op.
        await request(app).post(`/api/payments/${payment._id}/refunds/${payment.refunds[0]._id}/retry`).set(authHeader(provider));
        expect(await LedgerEntry.countDocuments({ type: 'refund' })).toBe(1);
    });

    it('manual partial refunds by the owner, never more than was paid', async () => {
        const { provider, service } = await setup();
        const res = await bookAsGuest(service);
        const payment = await payFor(res);
        const r1 = await request(app).post(`/api/payments/${payment._id}/refund`).set(authHeader(provider)).send({ amountCents: 5000, reason: 'Shorter cut' });
        expect(r1.status).toBe(200);
        expect(r1.body.data).toMatchObject({ status: 'partially_refunded', refundedCents: 5000, refundableCents: 15000 });
        const tooMuch = await request(app).post(`/api/payments/${payment._id}/refund`).set(authHeader(provider)).send({ amountCents: 15001 });
        expect(tooMuch.status).toBe(409);
        const bad = await request(app).post(`/api/payments/${payment._id}/refund`).set(authHeader(provider)).send({ amountCents: 10.5 });
        expect(bad.status).toBe(400);
        const rest = await request(app).post(`/api/payments/${payment._id}/refund`).set(authHeader(provider)).send({});
        expect(rest.body.data).toMatchObject({ status: 'refunded', refundedCents: 20000 });
        expect(await ledgerSum(provider._id)).toBe(0);
        expect((await Appointment.findById(res.body.data._id)).paymentStatus).toBe('refunded');
    });

    it('commission (PLATFORM_COMMISSION_BPS) is taken per payment and handed back on refund', async () => {
        process.env.PLATFORM_COMMISSION_BPS = '500'; // 5%
        try {
            const { provider, service } = await setup();
            const res = await bookAsGuest(service);
            const payment = await payFor(res);
            expect(payment.commissionBps).toBe(500);
            expect(await ledgerSum(provider._id)).toBe(19000);
            expect(await LedgerEntry.findOne({ type: 'commission' })).toMatchObject({ amountCents: -1000, commissionBps: 500 });
            await request(app).post(`/api/payments/${payment._id}/refund`).set(authHeader(provider)).send({ amountCents: 10000 });
            expect(await ledgerSum(provider._id)).toBe(9500);
        } finally {
            delete process.env.PLATFORM_COMMISSION_BPS;
        }
    });
});

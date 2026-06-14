/**
 * Intake / consent forms integration tests.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const {
    makeUser, makeProvider,
    makeService, makeAppointment,
    authHeader,
} = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

describe('Forms', () => {
    it('provider creates a template and customer sees it for their appointment', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id, { status: 'confirmed' });

        const create = await request(app)
            .post('/api/forms/templates')
            .set(authHeader(provider))
            .send({ title: 'Intake', fields: [{ label: 'Allergies?', type: 'text', required: true }] });
        expect(create.status).toBe(201);

        const forApptRes = await request(app)
            .get(`/api/forms/for-appointment/${appt._id}`)
            .set(authHeader(customer));
        expect(forApptRes.status).toBe(200);
        expect(forApptRes.body.data).toHaveLength(1);
        expect(forApptRes.body.data[0].completed).toBe(false);
    });

    it('rejects a submission missing a required field', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id, { status: 'confirmed' });

        const create = await request(app)
            .post('/api/forms/templates')
            .set(authHeader(provider))
            .send({ title: 'Intake', fields: [{ label: 'Allergies?', type: 'text', required: true }] });
        const templateId = create.body.data._id;

        const res = await request(app)
            .post('/api/forms/submissions')
            .set(authHeader(customer))
            .send({ template: templateId, appointment: appt._id, answers: [] });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/required/i);
    });

    it('accepts a valid submission and marks the form completed', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id, { status: 'confirmed' });

        const create = await request(app)
            .post('/api/forms/templates')
            .set(authHeader(provider))
            .send({ title: 'Intake', fields: [{ label: 'Allergies?', type: 'text', required: true }] });
        const templateId = create.body.data._id;

        const submit = await request(app)
            .post('/api/forms/submissions')
            .set(authHeader(customer))
            .send({ template: templateId, appointment: appt._id, answers: [{ label: 'Allergies?', value: 'None' }] });
        expect(submit.status).toBe(201);

        const forApptRes = await request(app)
            .get(`/api/forms/for-appointment/${appt._id}`)
            .set(authHeader(customer));
        expect(forApptRes.body.data[0].completed).toBe(true);

        // Provider can read the submission
        const subs = await request(app)
            .get(`/api/forms/submissions?appointment=${appt._id}`)
            .set(authHeader(provider));
        expect(subs.status).toBe(200);
        expect(subs.body.data).toHaveLength(1);
        expect(subs.body.data[0].answers[0].value).toBe('None');
    });

    it('only the owning provider can edit a template', async () => {
        const providerA = await makeProvider();
        const providerB = await makeProvider();
        const create = await request(app)
            .post('/api/forms/templates')
            .set(authHeader(providerA))
            .send({ title: 'A form', fields: [] });
        const id = create.body.data._id;

        const res = await request(app)
            .put(`/api/forms/templates/${id}`)
            .set(authHeader(providerB))
            .send({ title: 'Hijacked' });
        expect(res.status).toBe(403);
    });
});

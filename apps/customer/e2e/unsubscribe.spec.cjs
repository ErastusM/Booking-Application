// Marketing email is opt-in and every one can be unsubscribed in one click
// (compliance audit point 11). A guest who ticked the box gets "Book again"
// after a completed visit; its link opens the public /unsubscribe page, which
// works without signing in, turns the email off, and offers an undo. A guest
// who did not tick the box never gets it.
const { test, expect } = require('@playwright/test');
const { SEED } = require('./helpers.cjs');

const API = `http://localhost:${process.env.E2E_API_PORT || 5052}`;

const dayOut = (n) => {
    const d = new Date(); d.setDate(d.getDate() + n);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const setup = async (request) => {
    const services = await (await request.get(`${API}/api/services`)).json();
    const svc = (services.data || services).find((s) => s.name === SEED.serviceName);
    const login = await (await request.post(`${API}/api/auth/login`, { data: { ...SEED.provider, accountType: 'business' } })).json();
    return { serviceId: svc._id, providerToken: login.data.token };
};

const bookAsGuest = async (request, serviceId, email, { optIn, day, time }) => {
    const res = await request.post(`${API}/api/appointments`, {
        data: {
            service: serviceId, appointmentDate: dayOut(day), startTime: time, endTime: time.replace(':00', ':30'),
            guestName: 'Una Subscriber', guestEmail: email, ...(optIn ? { marketingOptIn: true } : {}),
        },
    });
    expect(res.status()).toBe(201);
    return (await res.json()).data._id;
};

const complete = (request, token, id) => request.put(`${API}/api/appointments/${id}/status`, {
    headers: { Authorization: `Bearer ${token}` }, data: { status: 'completed' },
});

const rebookingEmails = async (request, email) =>
    (await (await request.get(`${API}/__e2e/outbox?to=${encodeURIComponent(email)}`)).json()).filter((m) => m.fn === 'sendRebookingPrompt');

test('a guest who ticked the box gets "Book again" and can unsubscribe in one click, without signing in', async ({ page, request }) => {
    const { serviceId, providerToken } = await setup(request);
    const email = `e2e-unsub-${Date.now()}@bookplus.dev`;
    const first = await bookAsGuest(request, serviceId, email, { optIn: true, day: 21, time: '15:00' });
    const second = await bookAsGuest(request, serviceId, email, { optIn: true, day: 22, time: '15:00' });

    expect((await complete(request, providerToken, first)).status()).toBe(200);
    const [mail] = await rebookingEmails(request, email);
    expect(mail).toBeTruthy();
    const token = mail.args[5].unsubscribeToken;
    expect(token).toBeTruthy();

    // The link from the email footer — opened with no session at all.
    await page.goto(`/unsubscribe/${token}`);
    const card = page.getByTestId('unsubscribe-card');
    await expect(card).toHaveAttribute('data-state', 'unsubscribed');
    await expect(page.getByRole('heading', { name: /You’re unsubscribed/ })).toBeVisible();
    await expect(card).toContainText('Emails about your bookings');

    // Unsubscribed means unsubscribed: the next completed visit sends nothing.
    expect((await complete(request, providerToken, second)).status()).toBe(200);
    expect(await rebookingEmails(request, email)).toHaveLength(1);

    // Undo is offered and works.
    await page.getByTestId('unsubscribe-undo').click();
    await expect(card).toHaveAttribute('data-state', 'subscribed');
});

test('a guest who did not tick the box never gets "Book again"', async ({ request }) => {
    const { serviceId, providerToken } = await setup(request);
    const email = `e2e-nooptin-${Date.now()}@bookplus.dev`;
    const id = await bookAsGuest(request, serviceId, email, { optIn: false, day: 23, time: '16:00' });
    expect((await complete(request, providerToken, id)).status()).toBe(200);
    const outbox = await (await request.get(`${API}/__e2e/outbox?to=${encodeURIComponent(email)}`)).json();
    expect(outbox.map((m) => m.fn)).toContain('sendAppointmentCompleted'); // the service email still goes
    expect(outbox.map((m) => m.fn)).not.toContain('sendRebookingPrompt');
});

test('a forged link is refused and changes nothing', async ({ page }) => {
    await page.goto('/unsubscribe/eyJrIjoidSIsImlkIjoiNjRiN2YwYzJhMWIyYzNkNGU1ZjYwNzE4In0.forgedforgedforgedforgedforged12');
    await expect(page.getByTestId('unsubscribe-card')).toHaveAttribute('data-state', 'error');
});

test('the guest booking form offers the marketing box unticked, and sends the guest’s own choice', async ({ page }) => {
    await page.goto('/');
    await page.getByText(SEED.providerName, { exact: false }).first().click();
    await page.getByRole('button', { name: /book now/i }).first().click();
    await page.getByTestId('booking-staff').first().click();
    await page.getByTestId('booking-service').first().click();
    await page.getByRole('button', { name: 'Next month' }).click();
    await page.locator('[data-testid="booking-date"]:not([disabled])').nth(2).click();
    await page.getByTestId('booking-time').first().click();
    await page.getByTestId('booking-continue').click();

    const box = page.getByTestId('guest-marketing-optin');
    await expect(box).toBeVisible();
    await expect(box).not.toBeChecked();
    await page.getByTestId('guest-first-name').fill('Gail');
    await page.getByTestId('guest-last-name').fill('Guest');
    await page.getByLabel('Your email').fill(`e2e-guestform-${Date.now()}@bookplus.dev`);
    await box.check();

    const booked = page.waitForRequest((r) => /\/api\/appointments$/.test(r.url()) && r.method() === 'POST');
    await page.getByTestId('booking-confirm').click();
    expect(JSON.parse((await booked).postData())).toMatchObject({ marketingOptIn: true, guestName: 'Gail Guest' });
});

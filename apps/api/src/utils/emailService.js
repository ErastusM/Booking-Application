const nodemailer = require('nodemailer');
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Resend HTTP API (https://resend.com) — sends over port 443, so email works
// even when the host firewalls outbound SMTP ports (465/587). Preferred when set.
const EMAIL_API_KEY = process.env.EMAIL_API_KEY;

const emailConfigured = !!(EMAIL_API_KEY || (process.env.EMAIL_USER && process.env.EMAIL_PASS));

// Env-driven SMTP (defaults to Hostinger). Port 465 uses SSL; 587 uses STARTTLS.
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.hostinger.com';
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT, 10) || 465;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Bookplus';
// What recipients see in the From header — must match the authenticated mailbox.
exports.FROM = `"${EMAIL_FROM_NAME}" <${process.env.EMAIL_USER}>`;
const FROM = exports.FROM;

const transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_PORT === 465,   // SSL on 465, STARTTLS otherwise
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
});

// Boot-time status (purely informational, never fatal).
if (EMAIL_API_KEY) {
    logger.info('Email configured via Resend HTTP API (port 443) — SMTP bypassed');
} else if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    // Skip the live verify() under test — it opens a real socket to the SMTP host,
    // which makes the suite hit the network (slow/flaky) and leaves open handles.
    if (process.env.NODE_ENV !== 'test') {
        transporter.verify()
            .then(() => logger.info({ host: EMAIL_HOST, port: EMAIL_PORT, user: process.env.EMAIL_USER }, 'SMTP ready'))
            .catch((err) => logger.warn({ err: err.message, host: EMAIL_HOST }, 'SMTP verify failed — emails will be skipped/retried per-send'));
    }
} else {
    logger.info('Email not configured (set EMAIL_API_KEY, or EMAIL_USER/EMAIL_PASS) — emails disabled');
}

// Send via Resend's HTTPS API (used when EMAIL_API_KEY is set).
const sendViaResend = async (mailOptions) => {
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: mailOptions.from || FROM,
            to: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
            subject: mailOptions.subject,
            html: mailOptions.html,
            text: mailOptions.text,
            ...(mailOptions.replyTo ? { reply_to: mailOptions.replyTo } : {}),
            ...(mailOptions.attachments?.length ? {
                attachments: mailOptions.attachments.map((a) => ({
                    filename: a.filename,
                    content: Buffer.isBuffer(a.content)
                        ? a.content.toString('base64')
                        : Buffer.from(String(a.content), 'utf-8').toString('base64'),
                    ...(a.contentType ? { content_type: a.contentType } : {}),
                })),
            } : {}),
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json().catch(() => ({}));
};

// Strip HTML tags and collapse whitespace to produce a plain-text fallback.
// Spam filters penalise HTML-only emails; providing both parts improves
// deliverability across all mail clients.
const htmlToText = (html) =>
    html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

/**
 * Email is a NON-CRITICAL side effect — it must never throw into a request
 * handler. If SMTP isn't configured, skip silently. If a send fails (e.g.
 * bad/expired Gmail credentials → EAUTH 535), log and swallow so booking,
 * status-change, cancel and reschedule requests can never 500 because of email.
 */
const safeSend = async (mailOptions) => {
    if (!emailConfigured) return { skipped: true };
    // Auto-generate plain text from HTML when not explicitly provided.
    const opts = mailOptions.html && !mailOptions.text
        ? { ...mailOptions, text: htmlToText(mailOptions.html) }
        : mailOptions;
    try {
        if (EMAIL_API_KEY) return await sendViaResend(opts);
        return await transporter.sendMail(opts);
    } catch (err) {
        logger.warn({ err: err.message, to: mailOptions && mailOptions.to }, 'Email send failed (non-fatal)');
        return { error: true };
    }
};

/**
 * Escape HTML special characters to prevent injection in email templates.
 */
const escapeHtml = (str) => {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

exports.transporter = transporter;
// Generic, transport-agnostic sender (Resend API when configured, else SMTP).
// Use this for one-off emails so they respect the same path as templates.
exports.sendRaw = safeSend;

/* ============================================================================
   Shared clean email layout (Fresha-grade): white card on a light canvas,
   system sans, one ink pill CTA, restrained gold accent. No serif, no emoji.
   ============================================================================ */

const C = {
    ink: '#040505', gold: '#b32c0d', text: '#52525b', muted: '#8f9391',
    border: '#d3d5d4', canvas: '#f4f4f5', card: '#ffffff', sunken: '#f7f6f4',
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Status pill (semantic, readable)
const statusPill = (status) => {
    const map = {
        confirmed: ['#e7f6ee', '#0e7a4f', 'Confirmed'],
        pending:   ['#fef3c7', '#92400e', 'Pending'],
        completed: ['#e7f6ee', '#0e7a4f', 'Completed'],
        cancelled: ['#fde8e8', '#b42318', 'Cancelled'],
        rescheduled: ['#fef3c7', '#92400e', 'Rescheduled'],
    };
    const [bg, fg, label] = map[status] || map.confirmed;
    return `<span style="display:inline-block;background:${bg};color:${fg};font-size:13px;font-weight:600;padding:5px 12px;border-radius:999px;">${label}</span>`;
};

const primaryButton = (href, label) =>
    `<a href="${href}" target="_blank" style="display:inline-block;background:${C.ink};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 30px;border-radius:999px;">${label}</a>`;

// Row of small outlined "action" links (Add to calendar / Directions / Manage)
const actionRow = (actions) => {
    const cells = actions.filter(Boolean).map(a =>
        `<a href="${a.href}" target="_blank" style="display:inline-block;border:1px solid ${C.border};color:${C.ink};text-decoration:none;font-size:13px;font-weight:600;padding:9px 16px;border-radius:999px;margin:4px 4px 0 0;">${a.label}</a>`
    ).join('');
    return `<div style="margin-top:18px;">${cells}</div>`;
};

// Table-based so labels/values keep their spacing in every client (Gmail/Outlook
// strip flexbox, which jammed "ServiceCar Wash" together).
const detailsCard = (rows, totalRow) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.sunken};border-radius:12px;margin-top:20px;">
      <tr><td style="padding:16px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${rows.map(([l, v]) => `
            <tr>
              <td style="font-size:14px;color:${C.muted};padding:6px 0;vertical-align:top;white-space:nowrap;">${l}</td>
              <td align="right" style="font-size:14px;color:${C.ink};font-weight:600;padding:6px 0 6px 16px;vertical-align:top;">${v}</td>
            </tr>`).join('')}
          ${totalRow ? `
            <tr><td colspan="2" style="border-top:1px solid ${C.border};font-size:0;line-height:0;padding-top:10px;">&nbsp;</td></tr>
            <tr>
              <td style="font-size:15px;color:${C.ink};font-weight:700;padding-top:2px;">${totalRow[0]}</td>
              <td align="right" style="font-size:15px;color:${C.ink};font-weight:700;padding-top:2px;">${totalRow[1]}</td>
            </tr>` : ''}
        </table>
      </td></tr>
    </table>`;

const shell = ({ heading, headingAccent, inner, preheader }) => `
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${C.canvas};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td align="center" style="padding-bottom:20px;">
          <span style="font-family:${FONT};font-size:24px;font-weight:800;color:${C.ink};letter-spacing:-0.02em;">Book<span style="color:${C.gold};">plus</span></span>
        </td></tr>
        <tr><td style="background:${C.card};border:1px solid ${C.border};border-radius:16px;padding:36px 32px;font-family:${FONT};">
          <h1 style="margin:0 0 18px;font-size:23px;line-height:1.3;font-weight:700;color:${C.ink};">${heading}${headingAccent ? ` <span style="color:${C.gold};">${headingAccent}</span>` : ''}</h1>
          ${inner}
        </td></tr>
        <tr><td align="center" style="padding:22px 12px;font-family:${FONT};">
          <p style="margin:0;color:${C.muted};font-size:12px;">© ${new Date().getFullYear()} Bookplus · Sent to keep you updated about your bookings.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

const p = (text) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${C.text};">${text}</p>`;

// Build an .ics calendar attachment from a raw iCalendar string (see calendarHelper).
// Lets recipients add the appointment to Google/Apple/Outlook calendars in one tap.
const icsAttachment = (ics) => ({
    filename: 'appointment.ics',
    content: ics,
    contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
});

/* ── Templates ─────────────────────────────────────────────────────────── */

exports.sendVerificationEmail = async (email, name, token, role) => {
    const url = `${process.env.SERVER_URL}/api/auth/verify-email?token=${token}`;
    const isProvider = role === 'provider';
    await safeSend({
        from: FROM, to: email,
        subject: isProvider
            ? 'Verify your email to list your business on Bookplus'
            : 'Verify your Bookplus account',
        html: shell({
            heading: isProvider
                ? `Hi ${escapeHtml(name)}, one step to go`
                : `Hi ${escapeHtml(name)}, please verify your email`,
            preheader: isProvider
                ? 'Verify your email to activate your account and start receiving bookings.'
                : 'Confirm your email to activate your Bookplus account.',
            inner: isProvider
                ? `${p("You’re almost ready to start listing your services and receiving bookings on Bookplus. Verify your email to activate your account and continue setting up your business.")}
                   <div style="margin:24px 0;">${primaryButton(url, 'Verify & set up my business')}</div>
                   ${p(`<span style="color:${C.muted};font-size:13px;">This link expires in 24 hours. If you didn’t create a Bookplus account, you can ignore this email.</span>`)}`
                : `${p('To keep your account secure we need to confirm this email address belongs to you. It only takes a second.')}
                   <div style="margin:24px 0;">${primaryButton(url, 'Verify & find providers')}</div>
                   ${p(`<span style="color:${C.muted};font-size:13px;">This link expires in 24 hours. If you didn’t create a Bookplus account, you can ignore this email.</span>`)}`,
        }),
    });
};

exports.sendWelcomeEmail = async (email, name, role) => {
    const isProvider = role === 'provider';
    await safeSend({
        from: FROM, to: email,
        subject: isProvider ? 'Your business account is ready' : 'Welcome to Bookplus',
        html: shell({
            heading: isProvider ? "You’re verified," : "You’re all set,",
            headingAccent: escapeHtml(name),
            preheader: isProvider
                ? 'Your Bookplus business account is active.'
                : 'Your Bookplus account is verified.',
            inner: isProvider
                ? `${p("Your account is verified. Complete your business profile, add your services, and you’ll be ready to receive bookings.")}
                   <div style="margin:24px 0;">${primaryButton(`${process.env.CLIENT_URL || '#'}/dashboard`, 'Set up my business')}</div>`
                : `${p('Your account is verified. You can now discover providers and book appointments in a few taps.')}
                   <div style="margin:24px 0;">${primaryButton(`${process.env.CLIENT_URL || '#'}/providers`, 'Find providers')}</div>`,
        }),
    });
};

exports.sendAppointmentConfirmed = async (email, name, serviceName, date, time, gcalUrl, extras = {}) => {
    const { staff, price, bookingRef, manageUrl, directionsUrl, venue, address, ics } = extras;
    const rows = [
        ['Service', escapeHtml(serviceName) + (staff ? ` · ${escapeHtml(staff)}` : '')],
        ['When', `${date}, ${time}`],
    ];
    if (venue) rows.push(['Venue', escapeHtml(venue)]);
    if (bookingRef) rows.push(['Booking ref', bookingRef]);
    const total = price != null ? ['Total', `NAD ${price}`] : null;
    await safeSend({
        from: FROM, to: email, subject: 'Your appointment is confirmed',
        attachments: ics ? [icsAttachment(ics)] : undefined,
        html: shell({
            heading: `Hi ${escapeHtml(name)}, your appointment is`, headingAccent: 'confirmed',
            preheader: `${serviceName} · ${date}, ${time}`,
            inner: `${statusPill('confirmed')}
                ${detailsCard(rows, total)}
                ${address ? p(`<span style="color:${C.muted};font-size:13px;">${escapeHtml(address)}</span>`) : ''}
                ${actionRow([
                    gcalUrl && { href: gcalUrl, label: 'Add to calendar' },
                    directionsUrl && { href: directionsUrl, label: 'Directions' },
                    manageUrl && { href: manageUrl, label: 'Manage booking' },
                ])}
                <p style="margin:20px 0 0;font-size:13px;color:${C.muted};">Please arrive a few minutes early. Need to change plans? Use “Manage booking”.</p>`,
        }),
    });
};

exports.sendAppointmentCompleted = async (email, name, serviceName) => {
    await safeSend({
        from: FROM, to: email, subject: 'Thanks for visiting',
        html: shell({
            heading: `Thanks, ${escapeHtml(name)}!`,
            preheader: `How was your ${serviceName}?`,
            inner: `${p(`Your <strong>${escapeHtml(serviceName)}</strong> appointment is complete. We’d love your feedback.`)}
                <div style="margin:24px 0;">${primaryButton(`${process.env.CLIENT_URL || '#'}/appointments`, 'Leave a review')}</div>`,
        }),
    });
};

exports.sendAppointmentCancelled = async (email, name, serviceName, date) => {
    await safeSend({
        from: FROM, to: email, subject: 'Your appointment was cancelled',
        html: shell({
            heading: 'Your appointment was cancelled',
            preheader: `${serviceName} · ${date}`,
            inner: `${statusPill('cancelled')}
                ${detailsCard([['Service', escapeHtml(serviceName)], ['When', date]])}
                ${p(`<span style="margin-top:16px;display:inline-block;">Changed your mind? You can rebook anytime.</span>`)}
                <div style="margin:18px 0 0;">${primaryButton(`${process.env.CLIENT_URL || '#'}/services`, 'Book again')}</div>`,
        }),
    });
};

exports.sendAppointmentRescheduled = async (email, providerName, customerName, serviceName, date, time) => {
    await safeSend({
        from: FROM, to: email, subject: 'An appointment was rescheduled',
        html: shell({
            heading: 'An appointment was rescheduled',
            preheader: `${serviceName} · ${date}, ${time}`,
            inner: `${statusPill('rescheduled')}
                ${detailsCard([['Client', escapeHtml(customerName)], ['Service', escapeHtml(serviceName)], ['New time', `${date}, ${time}`]])}`,
        }),
    });
};

// Customer-facing reschedule notice (the variant above goes to the provider).
exports.sendAppointmentRescheduledClient = async (email, name, serviceName, date, time, extras = {}) => {
    const { gcalUrl, manageUrl, ics } = extras;
    await safeSend({
        from: FROM, to: email, subject: 'Your appointment was rescheduled',
        attachments: ics ? [icsAttachment(ics)] : undefined,
        html: shell({
            heading: 'Your appointment was', headingAccent: 'rescheduled',
            preheader: `${serviceName} · now ${date}, ${time}`,
            inner: `${statusPill('rescheduled')}
                ${detailsCard([['Service', escapeHtml(serviceName)], ['New time', `${date}, ${time}`]])}
                ${actionRow([
                    gcalUrl && { href: gcalUrl, label: 'Add to calendar' },
                    manageUrl && { href: manageUrl, label: 'Manage booking' },
                ])}
                <p style="margin:18px 0 0;font-size:13px;color:${C.muted};">Didn’t request this change? Use “Manage booking” or contact your provider.</p>`,
        }),
    });
};

exports.sendReminder24h = async (email, name, serviceName, date, time, extras = {}) => {
    const { gcalUrl, manageUrl, ics } = extras;
    await safeSend({
        from: FROM, to: email, subject: `Reminder: ${serviceName} tomorrow`,
        attachments: ics ? [icsAttachment(ics)] : undefined,
        html: shell({
            heading: `Hi ${escapeHtml(name)}, a quick reminder`,
            preheader: `${serviceName} is tomorrow at ${time}`,
            inner: `${p(`Your <strong>${escapeHtml(serviceName)}</strong> is coming up <strong>tomorrow</strong>. We look forward to seeing you.`)}
                ${detailsCard([['Service', escapeHtml(serviceName)], ['When', `${date}, ${time}`]])}
                ${actionRow([
                    gcalUrl && { href: gcalUrl, label: 'Add to calendar' },
                    manageUrl && { href: manageUrl, label: 'Manage booking' },
                ])}
                <p style="margin:18px 0 0;font-size:13px;color:${C.muted};">Need to make a change? Use “Manage booking”.</p>`,
        }),
    });
};

exports.sendReminder1h = async (email, name, serviceName, time, extras = {}) => {
    const { gcalUrl, manageUrl, ics } = extras;
    await safeSend({
        from: FROM, to: email, subject: `Reminder: ${serviceName} in about an hour`,
        attachments: ics ? [icsAttachment(ics)] : undefined,
        html: shell({
            heading: `Hi ${escapeHtml(name)}, see you soon`,
            preheader: `${serviceName} is in about an hour, at ${time}`,
            inner: `${p(`Your <strong>${escapeHtml(serviceName)}</strong> is in about an hour, at <strong>${time}</strong>. Please arrive a few minutes early.`)}
                ${actionRow([
                    gcalUrl && { href: gcalUrl, label: 'Add to calendar' },
                    manageUrl && { href: manageUrl, label: 'Manage booking' },
                ])}`,
        }),
    });
};

exports.sendRebookingPrompt = async (email, name, serviceName, providerName, providerId) => {
    const href = `${process.env.CLIENT_URL || '#'}/book-appointment?providerId=${providerId || ''}`;
    await safeSend({
        from: FROM, to: email, subject: `Time for another ${serviceName}?`,
        html: shell({
            heading: `Hi ${escapeHtml(name)}, ready for your next visit?`,
            preheader: `Rebook ${serviceName} with ${providerName}`,
            inner: `${p(`It’s been a little while since your <strong>${escapeHtml(serviceName)}</strong> with ${escapeHtml(providerName)}. Book your next appointment in a couple of taps.`)}
                <div style="margin:24px 0;">${primaryButton(href, 'Book again')}</div>`,
        }),
    });
};

exports.sendPasswordResetEmail = async (email, name, token) => {
    const url = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
    await safeSend({
        from: FROM, to: email, subject: 'Reset your Bookplus password',
        html: shell({
            heading: `Hi ${escapeHtml(name)}, reset your password`,
            preheader: 'Reset your Bookplus password.',
            inner: `${p('We received a request to reset your password. Click below to choose a new one.')}
                <div style="margin:24px 0;">${primaryButton(url, 'Reset password')}</div>
                ${p(`<span style="color:${C.muted};font-size:13px;">This link expires in 1 hour. If you didn’t request this, you can safely ignore it.</span>`)}`,
        }),
    });
};

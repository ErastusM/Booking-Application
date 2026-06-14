const nodemailer = require('nodemailer');
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const emailConfigured = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,          // SSL — avoids DigitalOcean's port-587 block
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
});

/**
 * Email is a NON-CRITICAL side effect — it must never throw into a request
 * handler. If SMTP isn't configured, skip silently. If a send fails (e.g.
 * bad/expired Gmail credentials → EAUTH 535), log and swallow so booking,
 * status-change, cancel and reschedule requests can never 500 because of email.
 */
const safeSend = async (mailOptions) => {
    if (!emailConfigured) return { skipped: true };
    try {
        return await transporter.sendMail(mailOptions);
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

exports.sendVerificationEmail = async (email, name, token) => {
    const verificationUrl = `${process.env.SERVER_URL}/api/auth/verify-email?token=${token}`;

    const mailOptions = {
        from: `"Bookplus" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Verify your Bookplus account',
        html: `
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #fafaf8;">
            
            <!-- Header -->
            <div style="background: #1a1a2e; padding: 2.5rem 2rem; text-align: center;">
                <h1 style="font-family: Georgia, serif; color: #c9a84c; font-size: 2rem; margin: 0; letter-spacing: 0.05em;">
                    Book<span style="color: white;">plus</span>
                </h1>
            </div>

            <!-- Body -->
            <div style="padding: 2.5rem 2rem; background: white; border-left: 1px solid #e8e6e1; border-right: 1px solid #e8e6e1;">
                <h2 style="font-family: Georgia, serif; color: #1a1a2e; font-size: 1.5rem; margin-bottom: 1rem;">
                    Welcome, ${escapeHtml(name)}!
                </h2>
                <p style="color: #6b6b80; font-size: 0.95rem; line-height: 1.7; margin-bottom: 1.5rem;">
                    Thanks for signing up. Please verify your email address to activate your account and start booking appointments.
                </p>
                <div style="text-align: center; margin: 2rem 0;">
                    <a href="${verificationUrl}" 
                       style="background: #c9a84c; color: #1a1a2e; padding: 0.875rem 2.5rem; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 1rem; display: inline-block;">
                        Verify My Email →
                    </a>
                </div>
                <p style="color: #9b9baa; font-size: 0.8rem; line-height: 1.6;">
                    This link expires in <strong>24 hours</strong>. If you didn't create an account, you can safely ignore this email.
                </p>
            </div>

            <!-- Footer -->
            <div style="background: #f5f3ef; padding: 1.5rem 2rem; text-align: center; border: 1px solid #e8e6e1; border-top: none;">
                <p style="color: #9b9baa; font-size: 0.75rem; margin: 0;">
                    © 2026 Bookplus. All rights reserved.
                </p>
            </div>
        </div>
        `,
    };

    await safeSend(mailOptions);
};

exports.sendWelcomeEmail = async (email, name) => {
    const mailOptions = {
        from: `"Bookplus" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Your Bookplus account is verified!',
        html: `
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #fafaf8;">
            <div style="background: #1a1a2e; padding: 2.5rem 2rem; text-align: center;">
                <h1 style="font-family: Georgia, serif; color: #c9a84c; font-size: 2rem; margin: 0;">
                    Book<span style="color: white;">plus</span>
                </h1>
            </div>
            <div style="padding: 2.5rem 2rem; background: white; border-left: 1px solid #e8e6e1; border-right: 1px solid #e8e6e1;">
                <h2 style="font-family: Georgia, serif; color: #1a1a2e; font-size: 1.5rem; margin-bottom: 1rem;">
                    You're all set, ${escapeHtml(name)}! ✅
                </h2>
                <p style="color: #6b6b80; font-size: 0.95rem; line-height: 1.7;">
                    Your account has been verified. You can now discover and book services on Bookplus.
                </p>
            </div>
            <div style="background: #f5f3ef; padding: 1.5rem 2rem; text-align: center; border: 1px solid #e8e6e1; border-top: none;">
                <p style="color: #9b9baa; font-size: 0.75rem; margin: 0;">© 2026 Bookplus. All rights reserved.</p>
            </div>
        </div>
        `,
    };

    await safeSend(mailOptions);
};

exports.sendAppointmentConfirmed = async (email, name, serviceName, date, time, gcalUrl) => {
    await safeSend({
        from: `"Bookplus" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '✅ Your appointment is confirmed!',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
            <div style="background: #1a1a2e; padding: 2rem; text-align: center;">
                <h1 style="font-family: Georgia, serif; color: #c9a84c; margin: 0;">Bookplus</h1>
            </div>
            <div style="padding: 2rem; background: white; border: 1px solid #e8e6e1;">
                <h2 style="font-family: Georgia, serif; color: #1a1a2e;">Appointment Confirmed! ✂️</h2>
                <p style="color: #6b6b80;">Hi ${escapeHtml(name)}, your appointment has been confirmed.</p>
                <div style="background: #f5f3ef; padding: 1rem; border-radius: 8px; margin: 1.5rem 0;">
                    <p style="margin: 0.25rem 0;"><strong>Service:</strong> ${escapeHtml(serviceName)}</p>
                    <p style="margin: 0.25rem 0;"><strong>Date:</strong> ${date}</p>
                    <p style="margin: 0.25rem 0;"><strong>Time:</strong> ${time}</p>
                </div>
                <p style="color: #6b6b80; font-size: 0.85rem;">Please arrive 5 minutes early. See you soon!</p>
                ${gcalUrl ? `<div style="text-align: center; margin: 1.5rem 0;">
                    <a href="${gcalUrl}" target="_blank" style="display: inline-block; background: #4285F4; color: white; padding: 0.75rem 1.75rem; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 0.9rem;">📅 Add to Google Calendar</a>
                </div>` : ''}
            </div>
            <div style="background: #f5f3ef; padding: 1rem; text-align: center; border: 1px solid #e8e6e1; border-top: none;">
                <p style="color: #9b9baa; font-size: 0.75rem; margin: 0;">© 2026 Bookplus</p>
            </div>
        </div>`,
    });
};

exports.sendAppointmentCompleted = async (email, name, serviceName) => {
    await safeSend({
        from: `"Bookplus" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '🏆 How was your appointment?',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
            <div style="background: #1a1a2e; padding: 2rem; text-align: center;">
                <h1 style="font-family: Georgia, serif; color: #c9a84c; margin: 0;">Bookplus</h1>
            </div>
            <div style="padding: 2rem; background: white; border: 1px solid #e8e6e1;">
                <h2 style="font-family: Georgia, serif; color: #1a1a2e;">Thanks for visiting! 🙏</h2>
                <p style="color: #6b6b80;">Hi ${escapeHtml(name)}, we hope you enjoyed your <strong>${escapeHtml(serviceName)}</strong>.</p>
                <p style="color: #6b6b80;">We'd love to hear your feedback — leave a review on your appointments page!</p>
                <div style="text-align: center; margin: 1.5rem 0;">
                    <a href="${process.env.CLIENT_URL}/appointments" style="background: #c9a84c; color: #1a1a2e; padding: 0.75rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 700;">Leave a Review →</a>
                </div>
            </div>
            <div style="background: #f5f3ef; padding: 1rem; text-align: center; border: 1px solid #e8e6e1; border-top: none;">
                <p style="color: #9b9baa; font-size: 0.75rem; margin: 0;">© 2026 Bookplus</p>
            </div>
        </div>`,
    });
};

exports.sendAppointmentCancelled = async (email, name, serviceName, date) => {
    await safeSend({
        from: `"Bookplus" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '❌ Appointment Cancelled',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
            <div style="background: #1a1a2e; padding: 2rem; text-align: center;">
                <h1 style="font-family: Georgia, serif; color: #c9a84c; margin: 0;">Bookplus</h1>
            </div>
            <div style="padding: 2rem; background: white; border: 1px solid #e8e6e1;">
                <h2 style="font-family: Georgia, serif; color: #1a1a2e;">Appointment Cancelled</h2>
                <p style="color: #6b6b80;">Hi ${escapeHtml(name)}, your <strong>${escapeHtml(serviceName)}</strong> appointment on <strong>${date}</strong> has been cancelled.</p>
                <div style="text-align: center; margin: 1.5rem 0;">
                    <a href="${process.env.CLIENT_URL}/book-appointment" style="background: #c9a84c; color: #1a1a2e; padding: 0.75rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 700;">Book Again →</a>
                </div>
            </div>
            <div style="background: #f5f3ef; padding: 1rem; text-align: center; border: 1px solid #e8e6e1; border-top: none;">
                <p style="color: #9b9baa; font-size: 0.75rem; margin: 0;">© 2026 Bookplus</p>
            </div>
        </div>`,
    });
};

exports.sendAppointmentRescheduled = async (email, providerName, customerName, serviceName, date, time) => {
    await safeSend({
        from: `"Bookplus" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '🗓 Appointment Rescheduled',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
            <div style="background: #1a1a2e; padding: 2rem; text-align: center;">
                <h1 style="font-family: Georgia, serif; color: #c9a84c; margin: 0;">Bookplus</h1>
            </div>
            <div style="padding: 2rem; background: white; border: 1px solid #e8e6e1;">
                <h2 style="font-family: Georgia, serif; color: #1a1a2e;">Appointment Rescheduled</h2>
                <p style="color: #6b6b80;">Hi ${escapeHtml(providerName)}, <strong>${escapeHtml(customerName)}</strong> has rescheduled their appointment.</p>
                <div style="background: #f5f3ef; padding: 1rem; border-radius: 8px; margin: 1.5rem 0;">
                    <p style="margin: 0.25rem 0;"><strong>Service:</strong> ${escapeHtml(serviceName)}</p>
                    <p style="margin: 0.25rem 0;"><strong>New Date:</strong> ${date}</p>
                    <p style="margin: 0.25rem 0;"><strong>New Time:</strong> ${time}</p>
                </div>
                <p style="color: #6b6b80; font-size: 0.85rem;">Please confirm or decline this appointment from your dashboard.</p>
            </div>
            <div style="background: #f5f3ef; padding: 1rem; text-align: center; border: 1px solid #e8e6e1; border-top: none;">
                <p style="color: #9b9baa; font-size: 0.75rem; margin: 0;">© 2026 Bookplus</p>
            </div>
        </div>`,
    });
};

exports.sendReminder24h = async (email, name, serviceName, date, time) => {
    await safeSend({
        from: `"Bookplus" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '⏰ Reminder: Your appointment is tomorrow',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
            <div style="background: #1a1a2e; padding: 2rem; text-align: center;">
                <h1 style="font-family: Georgia, serif; color: #c9a84c; margin: 0;">Bookplus</h1>
            </div>
            <div style="padding: 2rem; background: white; border: 1px solid #e8e6e1;">
                <h2 style="font-family: Georgia, serif; color: #1a1a2e;">See you tomorrow!</h2>
                <p style="color: #6b6b80;">Hi ${escapeHtml(name)}, this is a friendly reminder that you have an upcoming appointment.</p>
                <div style="background: #f5f3ef; padding: 1rem; border-radius: 8px; margin: 1.5rem 0;">
                    <p style="margin: 0.25rem 0;"><strong>Service:</strong> ${escapeHtml(serviceName)}</p>
                    <p style="margin: 0.25rem 0;"><strong>Date:</strong> ${date}</p>
                    <p style="margin: 0.25rem 0;"><strong>Time:</strong> ${time}</p>
                </div>
                <p style="color: #6b6b80; font-size: 0.85rem;">If you need to cancel or reschedule, please do so at least 2 hours before your appointment.</p>
            </div>
            <div style="background: #f5f3ef; padding: 1rem; text-align: center; border: 1px solid #e8e6e1; border-top: none;">
                <p style="color: #9b9baa; font-size: 0.75rem; margin: 0;">© 2026 Bookplus</p>
            </div>
        </div>`,
    });
};

exports.sendReminder1h = async (email, name, serviceName, time) => {
    await safeSend({
        from: `"Bookplus" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '⏰ Reminder: Your appointment is in 1 hour',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
            <div style="background: #1a1a2e; padding: 2rem; text-align: center;">
                <h1 style="font-family: Georgia, serif; color: #c9a84c; margin: 0;">Bookplus</h1>
            </div>
            <div style="padding: 2rem; background: white; border: 1px solid #e8e6e1;">
                <h2 style="font-family: Georgia, serif; color: #1a1a2e;">Your appointment is soon</h2>
                <p style="color: #6b6b80;">Hi ${escapeHtml(name)}, your <strong>${escapeHtml(serviceName)}</strong> appointment starts at <strong>${time}</strong> — just 1 hour away!</p>
                <p style="color: #6b6b80; font-size: 0.85rem;">Please arrive a few minutes early. We look forward to seeing you.</p>
            </div>
            <div style="background: #f5f3ef; padding: 1rem; text-align: center; border: 1px solid #e8e6e1; border-top: none;">
                <p style="color: #9b9baa; font-size: 0.75rem; margin: 0;">© 2026 Bookplus</p>
            </div>
        </div>`,
    });
};

exports.sendRebookingPrompt = async (email, name, serviceName, providerName, providerId) => {
    const bookUrl = `${process.env.CLIENT_URL || 'http://localhost:3001'}/book-appointment?providerId=${providerId}`;
    await safeSend({
        from: `"Bookplus" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '✨ Book your next appointment',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
            <div style="background: #1a1a2e; padding: 2rem; text-align: center;">
                <h1 style="font-family: Georgia, serif; color: #c9a84c; margin: 0;">Bookplus</h1>
            </div>
            <div style="padding: 2rem; background: white; border: 1px solid #e8e6e1;">
                <h2 style="font-family: Georgia, serif; color: #1a1a2e;">Glad you came in!</h2>
                <p style="color: #6b6b80;">Hi ${escapeHtml(name)}, thank you for your recent <strong>${escapeHtml(serviceName)}</strong> with ${escapeHtml(providerName)}. We'd love to see you again!</p>
                <div style="text-align: center; margin: 2rem 0;">
                    <a href="${bookUrl}" style="background: #c9a84c; color: #1a1a2e; text-decoration: none; padding: 0.75rem 2rem; border-radius: 6px; font-weight: bold; font-size: 1rem;">Book Again</a>
                </div>
                <p style="color: #6b6b80; font-size: 0.85rem; text-align: center;">Regular appointments keep you looking your best.</p>
            </div>
            <div style="background: #f5f3ef; padding: 1rem; text-align: center; border: 1px solid #e8e6e1; border-top: none;">
                <p style="color: #9b9baa; font-size: 0.75rem; margin: 0;">© 2026 Bookplus</p>
            </div>
        </div>`,
    });
};

exports.sendPasswordResetEmail = async (email, name, token) => {
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const resetUrl = `${clientUrl}/reset-password?token=${token}`;

    await safeSend({
        from: `"Bookplus" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Reset your Bookplus password',
        html: `
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #fafaf8;">
            <div style="background: #1a1a2e; padding: 2.5rem 2rem; text-align: center;">
                <h1 style="font-family: Georgia, serif; color: #c9a84c; font-size: 2rem; margin: 0; letter-spacing: 0.05em;">
                    Book<span style="color: white;">plus</span>
                </h1>
            </div>
            <div style="padding: 2.5rem 2rem; background: white; border-left: 1px solid #e8e6e1; border-right: 1px solid #e8e6e1;">
                <h2 style="font-family: Georgia, serif; color: #1a1a2e; font-size: 1.5rem; margin-bottom: 1rem;">
                    Reset your password
                </h2>
                <p style="color: #6b6b80; font-size: 0.95rem; line-height: 1.7; margin-bottom: 1.5rem;">
                    Hi ${escapeHtml(name)}, we received a request to reset the password for your Bookplus account.
                    Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.
                </p>
                <div style="text-align: center; margin: 2rem 0;">
                    <a href="${resetUrl}"
                       style="background: #c9a84c; color: #1a1a2e; padding: 0.875rem 2.5rem; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 1rem; display: inline-block;">
                        Reset Password →
                    </a>
                </div>
                <p style="color: #9b9baa; font-size: 0.82rem; text-align: center; margin-top: 1.5rem;">
                    If you didn't request this, you can safely ignore this email. Your password won't change.
                </p>
            </div>
            <div style="background: #f5f3ef; padding: 1rem 2rem; text-align: center; border: 1px solid #e8e6e1; border-top: none;">
                <p style="color: #9b9baa; font-size: 0.75rem; margin: 0;">© 2026 Bookplus</p>
            </div>
        </div>`,
    });
};
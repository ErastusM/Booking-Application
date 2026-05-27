const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

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
                    Welcome, ${name}!
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

    await transporter.sendMail(mailOptions);
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
                    You're all set, ${name}! ✅
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

    await transporter.sendMail(mailOptions);
};

exports.sendAppointmentConfirmed = async (email, name, serviceName, date, time) => {
    await transporter.sendMail({
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
                <p style="color: #6b6b80;">Hi ${name}, your appointment has been confirmed.</p>
                <div style="background: #f5f3ef; padding: 1rem; border-radius: 8px; margin: 1.5rem 0;">
                    <p style="margin: 0.25rem 0;"><strong>Service:</strong> ${serviceName}</p>
                    <p style="margin: 0.25rem 0;"><strong>Date:</strong> ${date}</p>
                    <p style="margin: 0.25rem 0;"><strong>Time:</strong> ${time}</p>
                </div>
                <p style="color: #6b6b80; font-size: 0.85rem;">Please arrive 5 minutes early. See you soon!</p>
            </div>
            <div style="background: #f5f3ef; padding: 1rem; text-align: center; border: 1px solid #e8e6e1; border-top: none;">
                <p style="color: #9b9baa; font-size: 0.75rem; margin: 0;">© 2026 Bookplus</p>
            </div>
        </div>`,
    });
};

exports.sendAppointmentCompleted = async (email, name, serviceName) => {
    await transporter.sendMail({
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
                <p style="color: #6b6b80;">Hi ${name}, we hope you enjoyed your <strong>${serviceName}</strong>.</p>
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
    await transporter.sendMail({
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
                <p style="color: #6b6b80;">Hi ${name}, your <strong>${serviceName}</strong> appointment on <strong>${date}</strong> has been cancelled.</p>
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
    await transporter.sendMail({
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
                <p style="color: #6b6b80;">Hi ${providerName}, <strong>${customerName}</strong> has rescheduled their appointment.</p>
                <div style="background: #f5f3ef; padding: 1rem; border-radius: 8px; margin: 1.5rem 0;">
                    <p style="margin: 0.25rem 0;"><strong>Service:</strong> ${serviceName}</p>
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
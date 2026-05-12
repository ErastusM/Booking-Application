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
        from: `"BarberShop" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Verify your BarberShop account',
        html: `
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #fafaf8;">
            
            <!-- Header -->
            <div style="background: #1a1a2e; padding: 2.5rem 2rem; text-align: center;">
                <h1 style="font-family: Georgia, serif; color: #c9a84c; font-size: 2rem; margin: 0; letter-spacing: 0.05em;">
                    Barber<span style="color: white;">Shop</span>
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
                    © 2026 BarberShop. All rights reserved.
                </p>
            </div>
        </div>
        `,
    };

    await transporter.sendMail(mailOptions);
};

exports.sendWelcomeEmail = async (email, name) => {
    const mailOptions = {
        from: `"BarberShop" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Your BarberShop account is verified!',
        html: `
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #fafaf8;">
            <div style="background: #1a1a2e; padding: 2.5rem 2rem; text-align: center;">
                <h1 style="font-family: Georgia, serif; color: #c9a84c; font-size: 2rem; margin: 0;">
                    Barber<span style="color: white;">Shop</span>
                </h1>
            </div>
            <div style="padding: 2.5rem 2rem; background: white; border-left: 1px solid #e8e6e1; border-right: 1px solid #e8e6e1;">
                <h2 style="font-family: Georgia, serif; color: #1a1a2e; font-size: 1.5rem; margin-bottom: 1rem;">
                    You're all set, ${name}! ✂️
                </h2>
                <p style="color: #6b6b80; font-size: 0.95rem; line-height: 1.7;">
                    Your account has been verified. You can now book appointments with our expert barbers.
                </p>
            </div>
            <div style="background: #f5f3ef; padding: 1.5rem 2rem; text-align: center; border: 1px solid #e8e6e1; border-top: none;">
                <p style="color: #9b9baa; font-size: 0.75rem; margin: 0;">© 2026 BarberShop. All rights reserved.</p>
            </div>
        </div>
        `,
    };

    await transporter.sendMail(mailOptions);
};
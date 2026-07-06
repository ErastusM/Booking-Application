const { sendRaw } = require('../utils/emailService');

const escapeHtml = (str) => {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};

exports.submitSuggestion = async (req, res) => {
    try {
        const { category, message, email, name, role } = req.body;

        if (!message || typeof message !== 'string' || message.trim().length < 10) {
            return res.status(400).json({ success: false, message: 'Message must be at least 10 characters.' });
        }
        if (message.trim().length > 2000) {
            return res.status(400).json({ success: false, message: 'Message too long (max 2000 characters).' });
        }

        const safeMessage = escapeHtml(message.trim());
        const safeName    = escapeHtml((name || (req.user?.name) || 'Anonymous').substring(0, 100));
        const safeEmail   = escapeHtml((email || req.user?.email || 'N/A').substring(0, 200));
        const safeRole    = escapeHtml((role || req.user?.role || 'guest').substring(0, 30));
        const safeCategory = escapeHtml((category || 'General').substring(0, 50));

        const categoryColors = {
            'Feature Request': '#4f46e5',
            'Bug Report':      '#dc2626',
            'Improvement':     '#d97706',
            'Compliment':      '#16a34a',
            'General':         '#6b7280',
        };
        const badgeColor = categoryColors[safeCategory] || '#6b7280';

        await sendRaw({
            from: `"Bookplus Feedback" <${process.env.EMAIL_USER || 'info@bookplus.pro'}>`,
            to: process.env.SUGGESTIONS_EMAIL || 'info@bookplus.pro',
            replyTo: safeEmail !== 'N/A' ? safeEmail : undefined,
            subject: `[${safeCategory}] New suggestion from ${safeName}`,
            html: `
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #e6e8e7;">
                <div style="background: #040505; padding: 2rem; text-align: center;">
                    <h1 style="font-family: Georgia, serif; color: #f03e16; font-size: 1.8rem; margin: 0; letter-spacing: 0.05em;">Book<span style="color:white">plus</span></h1>
                    <p style="color: #9ca3af; font-size: 0.8rem; margin: 0.5rem 0 0; letter-spacing: 0.1em; text-transform: uppercase;">Suggestion Box</p>
                </div>
                <div style="padding: 2rem; background: white; border-left: 1px solid #d3d5d4; border-right: 1px solid #d3d5d4;">
                    <div style="display: inline-block; padding: 0.25rem 0.75rem; border-radius: 99px; background: ${badgeColor}18; color: ${badgeColor}; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 1.25rem;">${safeCategory}</div>
                    <h2 style="font-family: Georgia, serif; color: #040505; font-size: 1.35rem; margin: 0 0 1.5rem;">A new suggestion has been submitted</h2>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: 0.875rem;">
                        <tr style="border-bottom: 1px solid #dcdedd;">
                            <td style="padding: 0.6rem 0; color: #6b7280; width: 110px; font-weight: 600;">From</td>
                            <td style="padding: 0.6rem 0; color: #040505;">${safeName}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #dcdedd;">
                            <td style="padding: 0.6rem 0; color: #6b7280; font-weight: 600;">Email</td>
                            <td style="padding: 0.6rem 0; color: #040505;">${safeEmail}</td>
                        </tr>
                        <tr>
                            <td style="padding: 0.6rem 0; color: #6b7280; font-weight: 600;">User type</td>
                            <td style="padding: 0.6rem 0; color: #040505; text-transform: capitalize;">${safeRole}</td>
                        </tr>
                    </table>
                    <div style="background: #e6e8e7; border-left: 3px solid #f03e16; padding: 1.25rem 1.5rem; border-radius: 0 8px 8px 0; margin-bottom: 1.5rem;">
                        <p style="color: #040505; font-size: 0.95rem; line-height: 1.75; margin: 0; white-space: pre-wrap;">${safeMessage}</p>
                    </div>
                    <p style="color: #9ca3af; font-size: 0.78rem; margin: 0;">Submitted via Bookplus &bull; ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}</p>
                </div>
                <div style="background: #040505; padding: 1.25rem 2rem; text-align: center;">
                    <p style="color: #6b7280; font-size: 0.75rem; margin: 0;">Bookplus &copy; ${new Date().getFullYear()} &bull; bookplus.pro</p>
                </div>
            </div>`,
        });

        res.status(200).json({ success: true, message: 'Suggestion submitted. Thank you!' });
    } catch (err) {
        // Don't expose internal errors — always return success-looking response so users aren't blocked
        console.error('Suggestion email error:', err.message);
        res.status(200).json({ success: true, message: 'Suggestion submitted. Thank you!' });
    }
};

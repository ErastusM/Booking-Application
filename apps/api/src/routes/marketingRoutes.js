const express = require('express');
const rateLimit = require('express-rate-limit');
const { readUnsubscribeToken, setMarketingFromToken } = require('../utils/marketing');
const { primaryOrigin } = require('../utils/origins');

const router = express.Router();

// Public by design: an unsubscribe link must work without signing in. The token
// is signed (utils/marketing), so it can only ever switch OFF (or undo) the
// marketing email of the one recipient it was minted for.
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10000 : 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
});

const handle = (optIn) => async (req, res) => {
    const subject = readUnsubscribeToken(req.params.token);
    if (!subject) return res.status(400).json({ success: false, message: 'This unsubscribe link is not valid.' });
    try {
        const r = await setMarketingFromToken(subject, optIn, optIn ? 'unsubscribe_link_undo' : 'unsubscribe_link');
        if (!r.ok && r.reason === 'never_opted_in') {
            return res.status(403).json({ success: false, code: 'never_opted_in', message: 'This link can only switch these emails back on if you turned them on yourself. You can opt in from your account settings.' });
        }
        if (!r.ok) return res.status(404).json({ success: false, message: 'This unsubscribe link is no longer valid.' });
        res.set('Cache-Control', 'no-store');
        return res.status(200).json({
            success: true,
            data: { subscribed: optIn, kind: r.kind },
            message: optIn ? 'You’re subscribed again.' : 'You’re unsubscribed from Bookplus offers and rebooking reminders.',
        });
    } catch {
        return res.status(500).json({ success: false, message: 'Could not update your preference. Please try again.' });
    }
};

// RFC 8058 one-click: mail apps POST "List-Unsubscribe=One-Click" here (the
// List-Unsubscribe header). The customer app's /unsubscribe/<token> page posts here too.
router.post('/unsubscribe/:token', limiter, handle(false));
// "Undo" on the confirmation page.
router.post('/resubscribe/:token', limiter, handle(true));
// Someone opening the header URL in a browser: send them to the friendly page,
// which does the unsubscribe (a GET must not change anything — link scanners
// prefetch GETs).
router.get('/unsubscribe/:token', limiter, (req, res) => {
    res.redirect(302, `${primaryOrigin()}/unsubscribe/${encodeURIComponent(req.params.token)}`);
});

module.exports = router;

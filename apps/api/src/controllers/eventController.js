const Event = require('../models/Event');
const pino = require('pino');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const MAX_BATCH = 30;
const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : undefined);

// POST /api/events — batched, best-effort ingestion. Optional auth: an axios
// flush carries the bearer token so req.user is set and events are attributed;
// a sendBeacon flush on tab-close is anonymous but still carries the sessionId,
// so the funnel still stitches. NEVER throws to the client — analytics must not
// disrupt UX, so failures are swallowed and always acked 204.
exports.ingest = async (req, res) => {
    try {
        const { events, sessionId, app } = req.body || {};
        if (!Array.isArray(events) || events.length === 0) return res.status(204).end();

        const appName = app === 'business' ? 'business' : 'customer';
        const sid = clip(sessionId, 100);
        const ua = clip(req.get('user-agent'), 300);
        const userId = req.user ? req.user._id : null;

        const docs = events.slice(0, MAX_BATCH).map((e) => {
            let props = e && e.props;
            // Bound prop size — drop anything unreasonable rather than store blobs.
            try {
                if (props && JSON.stringify(props).length > 2000) props = undefined;
            } catch {
                props = undefined;
            }
            return {
                name: clip(e && e.name, 60) || 'unknown',
                app: appName,
                sessionId: sid,
                user: userId,
                path: clip(e && e.path, 200),
                props,
                ua,
                clientTs: typeof (e && e.t) === 'number' ? e.t : undefined,
            };
        });

        await Event.insertMany(docs, { ordered: false });
        return res.status(204).end();
    } catch (err) {
        logger.warn({ err: err.message }, 'event ingest failed (non-fatal)');
        return res.status(204).end();
    }
};

// GET /api/events/summary?days=7 — admin funnel snapshot. Counts by event name
// plus the two headline funnels (booking conversion, onboarding drop-off).
exports.summary = async (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const byName = await Event.aggregate([
            { $match: { createdAt: { $gte: since } } },
            { $group: { _id: '$name', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]);
        const totals = Object.fromEntries(byName.map((r) => [r._id, r.count]));

        const uniqueSessions = await Event.distinct('sessionId', {
            createdAt: { $gte: since },
            sessionId: { $ne: null },
        });

        const onbSteps = await Event.aggregate([
            { $match: { createdAt: { $gte: since }, name: 'onboarding_step' } },
            { $group: { _id: '$props.step', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]);

        const n = (k) => totals[k] || 0;
        const rate = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

        return res.json({
            range: { days, since },
            totalEvents: byName.reduce((s, r) => s + r.count, 0),
            uniqueSessions: uniqueSessions.length,
            totals,
            funnels: {
                booking: {
                    providerViews: n('provider_view'),
                    bookingStarts: n('booking_start'),
                    bookingConfirms: n('booking_confirm'),
                    viewToStartRate: rate(n('booking_start'), n('provider_view')),
                    startToConfirmRate: rate(n('booking_confirm'), n('booking_start')),
                },
                onboarding: {
                    completes: n('onboarding_complete'),
                    byStep: Object.fromEntries(onbSteps.map((r) => [r._id || 'unknown', r.count])),
                },
            },
        });
    } catch (err) {
        logger.error({ err: err.message }, 'event summary failed');
        return res.status(500).json({ success: false, message: 'Failed to build summary' });
    }
};

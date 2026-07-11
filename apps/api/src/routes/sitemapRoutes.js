const express = require('express');
const User = require('../models/User');
const { primaryOrigin } = require('../utils/origins');
const pino = require('pino');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const router = express.Router();

// The customer marketplace origin (www.bookplus.pro). Every public URL in the
// sitemap must be absolute and point at the customer site, never the API host.
const siteBase = () => (primaryOrigin() || 'https://www.bookplus.pro').replace(/\/$/, '');

const xmlEscape = (s) => String(s).replace(/[<>&'"]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
));

// Static, always-present marketplace pages.
const STATIC_PATHS = [
    { path: '/', changefreq: 'daily', priority: '1.0' },
    { path: '/about', changefreq: 'monthly', priority: '0.4' },
    { path: '/privacy-policy', changefreq: 'yearly', priority: '0.2' },
    { path: '/terms', changefreq: 'yearly', priority: '0.2' },
];

// GET /api/seo/sitemap.xml — nginx exposes this at www.bookplus.pro/sitemap.xml.
// Lists the marketplace's static pages plus every provider's public booking page
// (/b/:slug) so search engines can discover businesses without crawling the feed.
router.get('/sitemap.xml', async (req, res) => {
    try {
        const base = siteBase();
        const providers = await User.find({
            role: 'provider',
            'businessProfile.slug': { $type: 'string' },
        }).select('businessProfile.slug updatedAt').lean();

        const urls = [
            ...STATIC_PATHS.map(({ path, changefreq, priority }) =>
                `  <url>\n    <loc>${xmlEscape(base + path)}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
            ),
            ...providers.map((p) => {
                const loc = xmlEscape(`${base}/b/${p.businessProfile.slug}`);
                const lastmod = p.updatedAt ? new Date(p.updatedAt).toISOString().slice(0, 10) : null;
                return `  <url>\n    <loc>${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`;
            }),
        ];

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
        res.set('Content-Type', 'application/xml; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=21600'); // 6h — new providers appear within a crawl cycle
        return res.send(xml);
    } catch (err) {
        logger.error({ err: err.message }, 'sitemap generation failed');
        // A crawler-friendly empty sitemap beats a 500.
        res.set('Content-Type', 'application/xml; charset=utf-8');
        return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
    }
});

// ── Per-provider social share cards (prerender) ──────────────────────────────
// Social crawlers (WhatsApp, Facebook, Twitter/X, Slack…) don't run JS, so a
// shared booking link would unfurl with the generic site card. nginx routes
// crawler user-agents for /b/:slug and /providers/:id here; humans still get the
// SPA. We return a tiny HTML doc carrying that provider's OG/Twitter tags +
// LocalBusiness JSON-LD so the link preview shows their name, blurb and photo.

const htmlEscape = xmlEscape; // same entity set works for HTML attributes/text

// Build a one-line, length-bounded blurb from whatever the provider has filled in.
const providerBlurb = (p) => {
    const category = p.providerCategory && p.providerCategory !== 'Other' ? p.providerCategory : null;
    const city = (p.businessProfile?.address || '').split(',').map((s) => s.trim()).filter(Boolean).slice(-2, -1)[0];
    const bits = [];
    bits.push(category ? `Book ${category.toLowerCase()} online` : 'Book online');
    if (city) bits.push(`in ${city}`);
    let s = `${bits.join(' ')}. Reserve your slot with ${p.businessProfile?.businessName || p.name} on Bookplus.`;
    return s.length > 200 ? `${s.slice(0, 197)}…` : s;
};

const renderProviderCard = (p, canonical, base) => {
    const name = p.businessProfile?.businessName || p.name || 'Bookplus';
    const title = `${name} — Book on Bookplus`;
    const desc = providerBlurb(p);
    // og:image must be absolute. Provider avatars are stored as full Cloudinary
    // URLs; fall back to the brand icon on the marketplace origin.
    const image = (typeof p.avatar === 'string' && /^https?:\/\//.test(p.avatar)) ? p.avatar : `${base}/icon-512.png`;
    const jsonld = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name,
        description: desc,
        url: canonical,
        image,
        ...(p.businessProfile?.address ? { address: { '@type': 'PostalAddress', streetAddress: p.businessProfile.address } } : {}),
    }).replace(/</g, '\\u003c'); // neutralize any </script> inside JSON-LD

    const E = htmlEscape;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${E(title)}</title>
<meta name="description" content="${E(desc)}">
<link rel="canonical" href="${E(canonical)}">
<meta property="og:type" content="business.business">
<meta property="og:site_name" content="Bookplus">
<meta property="og:title" content="${E(name)}">
<meta property="og:description" content="${E(desc)}">
<meta property="og:url" content="${E(canonical)}">
<meta property="og:image" content="${E(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${E(name)}">
<meta name="twitter:description" content="${E(desc)}">
<meta name="twitter:image" content="${E(image)}">
<script type="application/ld+json">${jsonld}</script>
</head>
<body>
<h1>${E(name)}</h1>
<p>${E(desc)}</p>
<p><a href="${E(canonical)}">Book with ${E(name)} on Bookplus</a></p>
</body>
</html>
`;
};

// A generic marketplace card, used when the slug/id doesn't resolve — a crawler
// still gets a valid 200 unfurl instead of a broken preview.
const renderDefaultCard = (base) => {
    const E = htmlEscape;
    const title = 'Bookplus — Book local appointments online';
    const desc = 'Discover and book appointments with barbers, salons, spas and more across Southern Africa. Reserve your slot in seconds.';
    const image = `${base}/icon-512.png`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${E(title)}</title>
<meta name="description" content="${E(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Bookplus">
<meta property="og:title" content="${E(title)}">
<meta property="og:description" content="${E(desc)}">
<meta property="og:url" content="${E(base)}">
<meta property="og:image" content="${E(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${E(image)}">
</head>
<body><h1>${E(title)}</h1><p>${E(desc)}</p></body>
</html>
`;
};

const PROVIDER_FIELDS = 'name avatar providerCategory businessProfile role';

const sendCard = (res, html, maxAge = 3600) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    // Resolved provider cards cache 1h; the generic fallback (miss/error) caches
    // only briefly so a card fetched moments before a provider finishes onboarding
    // isn't stuck as the generic default.
    res.set('Cache-Control', `public, max-age=${maxAge}`);
    return res.status(200).send(html);
};
const DEFAULT_CARD_MAXAGE = 60;

// GET /api/seo/prerender/b/:slug
router.get('/prerender/b/:slug', async (req, res) => {
    const base = siteBase();
    try {
        const p = await User.findOne({
            role: 'provider',
            'businessProfile.slug': String(req.params.slug || '').toLowerCase(),
        }).select(PROVIDER_FIELDS).lean();
        if (!p) return sendCard(res, renderDefaultCard(base), DEFAULT_CARD_MAXAGE);
        return sendCard(res, renderProviderCard(p, `${base}/b/${p.businessProfile.slug}`, base));
    } catch (err) {
        logger.error({ err: err.message }, 'prerender by-slug failed');
        return sendCard(res, renderDefaultCard(base), DEFAULT_CARD_MAXAGE);
    }
});

// GET /api/seo/prerender/providers/:id
router.get('/prerender/providers/:id', async (req, res) => {
    const base = siteBase();
    try {
        const p = await User.findOne({ _id: req.params.id, role: 'provider' })
            .select(PROVIDER_FIELDS).lean();
        if (!p) return sendCard(res, renderDefaultCard(base), DEFAULT_CARD_MAXAGE);
        const canonical = p.businessProfile?.slug ? `${base}/b/${p.businessProfile.slug}` : `${base}/providers/${p._id}`;
        return sendCard(res, renderProviderCard(p, canonical, base));
    } catch (err) {
        // A bad ObjectId throws a CastError — still serve the default card, not a 500.
        logger.error({ err: err.message }, 'prerender by-id failed');
        return sendCard(res, renderDefaultCard(base), DEFAULT_CARD_MAXAGE);
    }
});

// GET /api/seo/robots.txt — nginx exposes this at www.bookplus.pro/robots.txt.
// Allow all crawlers; keep private/auth surfaces out of the index; point at the
// sitemap.
router.get('/robots.txt', (req, res) => {
    const base = siteBase();
    const body = [
        'User-agent: *',
        'Allow: /',
        // Keep private, auth-flow and tokenized surfaces out of the index.
        'Disallow: /appointments',
        'Disallow: /wallet',
        'Disallow: /profile',
        'Disallow: /login',
        'Disallow: /register',
        'Disallow: /manage/',        // tokenized "manage my booking" links
        'Disallow: /book-appointment',
        'Disallow: /waiting-list',
        'Disallow: /reset-password',
        'Disallow: /forgot-password',
        'Disallow: /verify-email',
        'Disallow: /auth/callback',
        'Disallow: /complete-profile',
        'Disallow: /become-provider',
        '',
        `Sitemap: ${base}/sitemap.xml`,
        '',
    ].join('\n');
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(body);
});

module.exports = router;

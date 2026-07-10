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

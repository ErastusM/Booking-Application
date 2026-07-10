import { useEffect } from 'react';

// Zero-dependency per-page <head> manager. Sets title, description, canonical,
// OpenGraph/Twitter tags and optional JSON-LD structured data imperatively so
// each route gets its own metadata. Googlebot renders our JS and reads these;
// non-JS social scrapers (Facebook/WhatsApp) only see the static defaults in
// index.html — richer per-provider share cards would need prerendering (a
// tracked follow-up).
//
// It ALWAYS writes a complete set of tags (falling back to the site defaults for
// anything a page doesn't supply) and restores those defaults on unmount, so a
// provider page's image/canonical never leak onto the next route.
const SITE_TITLE = 'Bookplus — Book trusted local services';
const DEFAULT_DESC = 'Discover and book trusted local businesses — hair, beauty, barbers, wellness, automotive and more. Real-time availability and instant confirmation.';

const siteOrigin = () => (typeof window !== 'undefined' ? window.location.origin : 'https://www.bookplus.pro');

const upsertMeta = (attr, key, content) => {
    let el = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
    }
    el.setAttribute('content', String(content ?? ''));
};

const upsertLink = (rel, href) => {
    let el = document.head.querySelector(`link[rel="${rel}"]`);
    if (!el) {
        el = document.createElement('link');
        el.setAttribute('rel', rel);
        document.head.appendChild(el);
    }
    el.setAttribute('href', href);
};

// Write the full managed set. Missing values fall back to the site defaults so
// no previous page's value can persist.
const applyHead = ({ title, description, image, url, type }) => {
    const origin = siteOrigin();
    const t = title || SITE_TITLE;
    const desc = description || DEFAULT_DESC;
    const u = url || `${origin}/`;
    const img = image || `${origin}/icon-512.png`;

    document.title = t;
    upsertMeta('name', 'description', desc);
    upsertLink('canonical', u);

    upsertMeta('property', 'og:title', t);
    upsertMeta('property', 'og:description', desc);
    upsertMeta('property', 'og:image', img);
    upsertMeta('property', 'og:url', u);
    upsertMeta('property', 'og:type', type || 'website');

    upsertMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    upsertMeta('name', 'twitter:title', t);
    upsertMeta('name', 'twitter:description', desc);
    upsertMeta('name', 'twitter:image', img);
};

const Seo = ({ title, description, image, url, type = 'website', jsonLd = null }) => {
    const jsonLdStr = jsonLd ? JSON.stringify(jsonLd) : null;

    useEffect(() => {
        applyHead({ title, description, image, url, type });

        let script = null;
        if (jsonLdStr) {
            script = document.createElement('script');
            script.type = 'application/ld+json';
            script.text = jsonLdStr;
            document.head.appendChild(script);
        }

        return () => {
            // Restore the site defaults so this page's title/description/canonical/
            // OG image don't bleed onto a route that has no <Seo>, and drop this
            // page's structured data.
            applyHead({});
            if (script && script.parentNode) script.parentNode.removeChild(script);
        };
    }, [title, description, image, url, type, jsonLdStr]);

    return null;
};

export default Seo;

/**
 * Instagram-style portfolio photos: one post shape for the business, and per
 * photo an optional crop (fractions of the original) and adjustments.
 */
const SHAPES = ['1:1', '4:5', '1.91:1'];
const RATIO = { '1:1': 1, '4:5': 4 / 5, '1.91:1': 1.91 };
const ADJUSTMENTS = ['brightness', 'contrast', 'warmth', 'saturation'];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A clean edit for `url`, or null when nothing valid is left. */
const cleanEdit = (e) => {
    if (!e || typeof e.url !== 'string' || !e.url) return null;
    const out = { url: e.url };
    const [x, y, w, h, ar] = ['x', 'y', 'w', 'h', 'ar'].map((k) => num(e[k]));
    if (x != null && y != null && w != null && h != null && w > 0 && h > 0) {
        out.w = clamp(w, 0.01, 1);
        out.h = clamp(h, 0.01, 1);
        out.x = clamp(x, 0, 1 - out.w);
        out.y = clamp(y, 0, 1 - out.h);
        if (ar != null && ar > 0) out.ar = clamp(ar, 0.05, 20);
    }
    ADJUSTMENTS.forEach((k) => { const v = num(e[k]); if (v != null && v !== 0) out[k] = clamp(Math.round(v), -100, 100); });
    return Object.keys(out).length > 1 ? out : null;
};

// The biggest crop with the frame's ratio that fits a photo of aspect `ar`.
const maxCrop = (ar, ratio) => (ar > ratio ? { w: ratio / ar, h: 1 } : { w: 1, h: ar / ratio });

/**
 * An edit whose crop has the post shape's ratio — the same framing (centre and
 * zoom) re-fitted when it was made for another shape, so a photo can never be
 * drawn stretched. Mirrors PhotoFrame's fitCrop in the apps. A crop that
 * doesn't say the photo's own shape (`ar`) can't be re-fitted: when the post
 * shape changes it falls back to automatic framing, keeping the adjustments.
 */
const fitEdit = (e, shape, shapeChanged) => {
    if (e.w == null) return e;
    const ratio = RATIO[shape] || 1;
    if (!(e.ar > 0)) {
        if (!shapeChanged) return e;
        const { x, y, w, h, ...rest } = e; // eslint-disable-line no-unused-vars
        return Object.keys(rest).length > 1 ? rest : null;
    }
    if (Math.abs((ratio * e.h) / e.w - e.ar) / e.ar < 0.001) return e; // already fits
    const zoom = Math.max(1, maxCrop(e.ar, (e.w * e.ar) / e.h).w / e.w);
    const base = maxCrop(e.ar, ratio);
    const w = base.w / zoom;
    const h = base.h / zoom;
    return { ...e, w, h, x: clamp(e.x + e.w / 2 - w / 2, 0, 1 - w), y: clamp(e.y + e.h / 2 - h / 2, 0, 1 - h) };
};

/** Edits kept only for photos still in `images`, one per URL. */
const cleanEdits = (edits, images) => {
    const keep = new Set(images || []);
    const seen = new Set();
    return (Array.isArray(edits) ? edits : [])
        .map(cleanEdit)
        .filter((e) => e && keep.has(e.url) && !seen.has(e.url) && seen.add(e.url));
};

/** The public shape + edits map for the photos a payload actually returns. */
const photoPresentation = (portfolio, photos) => {
    const byUrl = {};
    (portfolio?.edits || []).forEach((e) => { if (photos.includes(e.url)) byUrl[e.url] = { ...(e.toObject ? e.toObject() : e) }; });
    return { photoShape: SHAPES.includes(portfolio?.shape) ? portfolio.shape : '1:1', photoEdits: byUrl };
};

module.exports = { SHAPES, cleanEdit, cleanEdits, fitEdit, photoPresentation };

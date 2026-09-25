import React, { useId } from 'react';
import { cloudinaryPhoto } from '../utils/cloudinary';

// One portfolio photo, drawn the way its owner framed it (Instagram-style):
// the business's post shape, the photo's own crop (fractions of the original)
// and its adjustments. A photo nobody framed fills the shape anchored to the
// TOP — for a barber or stylist the haircut is the product, not the collar.
// The business app's editor draws with this same maths, so what the owner
// sees is what clients get. Keep in sync with apps/business.

export const SHAPES = [
    { id: '1:1', label: 'Square', ratio: 1 },
    { id: '4:5', label: 'Portrait 4:5', ratio: 4 / 5 },
    { id: '1.91:1', label: 'Landscape', ratio: 1.91 },
];
export const ratioOf = (shape) => (SHAPES.find((s) => s.id === shape) || SHAPES[0]).ratio;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// The biggest crop with the frame's ratio that fits a photo of aspect `ar` (width / height).
export const maxCrop = (ar, ratio) => (ar > ratio ? { w: ratio / ar, h: 1 } : { w: 1, h: ar / ratio });

// Where an unframed photo sits: full width (or height), anchored to the top.
export const defaultCrop = (ar, ratio) => {
    const { w, h } = maxCrop(ar, ratio);
    return { x: (1 - w) / 2, y: 0, w, h, ar };
};

export const hasCrop = (e) => !!e && e.w > 0 && e.h > 0 && e.x != null && e.y != null;

// The same framing in another shape (the owner switched the post shape):
// same centre, same zoom, kept inside the photo.
export const fitCrop = (e, ratio) => {
    if (!hasCrop(e) || !(e.ar > 0)) return null;
    const zoom = Math.max(1, maxCrop(e.ar, (e.w * e.ar) / e.h).w / e.w);
    const base = maxCrop(e.ar, ratio);
    const w = base.w / zoom, h = base.h / zoom;
    return { ...e, w, h, x: clamp(e.x + e.w / 2 - w / 2, 0, 1 - w), y: clamp(e.y + e.h / 2 - h / 2, 0, 1 - h) };
};

// A crop made for another shape would stretch the photo, so re-fit it.
const cropFor = (e, ratio) => {
    if (!hasCrop(e)) return null;
    if (!(e.ar > 0)) return e;
    return Math.abs((ratio * e.h) / e.w - e.ar) / e.ar < 0.02 ? e : fitCrop(e, ratio);
};

// CSS box for the <img> inside a frame: the crop scaled up to fill it.
export const cropBox = (c) => c
    ? { width: `${100 / c.w}%`, height: `${100 / c.h}%`, left: `${(-c.x / c.w) * 100}%`, top: `${(-c.y / c.h) * 100}%`, maxWidth: 'none' }
    : { left: 0, top: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' };

// Warmth is a colour-temperature shift (more red, less blue), which CSS
// filters can't express, so it's a one-matrix SVG filter the <img> points at.
export const WarmthFilter = ({ id, warmth }) => {
    const k = (warmth || 0) / 100;
    const values = `${1 + 0.15 * k} 0 0 0 0  0 ${1 + 0.04 * k} 0 0 0  0 0 ${1 - 0.18 * k} 0 0  0 0 0 1 0`;
    return (
        <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
            <filter id={id} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={values} /></filter>
        </svg>
    );
};

export const photoFilter = (e = {}, warmthId) => {
    const parts = [];
    if (e.warmth && warmthId) parts.push(`url(#${warmthId})`);
    if (e.brightness) parts.push(`brightness(${1 + e.brightness / 200})`);
    if (e.contrast) parts.push(`contrast(${1 + e.contrast / 200})`);
    if (e.saturation) parts.push(`saturate(${1 + e.saturation / 100})`);
    return parts.length ? parts.join(' ') : undefined;
};

export const useFilterId = () => `pf${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

const PhotoFrame = ({ src, width = 1000, edit, shape = '1:1', alt = '', className, style, imgProps = {}, children }) => {
    const ratio = ratioOf(shape);
    const crop = cropFor(edit, ratio);
    const warmthId = useFilterId();
    // A zoomed-in crop blows part of the photo up, so fetch enough pixels for it.
    const url = cloudinaryPhoto(src, Math.min(2400, Math.round(width / (crop ? crop.w : 1))));
    return (
        <div className={className} style={{ position: 'relative', overflow: 'hidden', aspectRatio: String(ratio), background: 'var(--warm-gray)', ...style }}>
            {edit?.warmth ? <WarmthFilter id={warmthId} warmth={edit.warmth} /> : null}
            <img src={url} alt={alt} draggable={false} {...imgProps} style={{ position: 'absolute', ...cropBox(crop), filter: photoFilter(edit, warmthId), display: 'block' }} />
            {children}
        </div>
    );
};

export default PhotoFrame;

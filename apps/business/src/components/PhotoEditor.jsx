import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SHAPES, ratioOf, maxCrop, defaultCrop, hasCrop, fitCrop, cropBox, photoFilter, WarmthFilter, useFilterId } from './PhotoFrame';
import { cloudinaryPhoto } from '../utils/cloudinary';

// Instagram-style editor for one portfolio photo. Crop: drag to move, pinch /
// scroll / slide to zoom, inside the post shape. Adjust: brightness, contrast,
// warmth, saturation. The original upload is never changed — the result is a
// crop (fractions of the photo) + adjustments that PhotoFrame applies, so the
// owner can reframe or undo any time. A photo the owner hasn't moved or zoomed
// saves no crop and stays on automatic framing (see PhotoFrame).

const ADJUSTMENTS = [
    { key: 'brightness', label: 'Brightness' },
    { key: 'contrast', label: 'Contrast' },
    { key: 'warmth', label: 'Warmth' },
    { key: 'saturation', label: 'Saturation' },
];
const MAX_ZOOM = 4;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round4 = (n) => Math.round(n * 10000) / 10000;

// A tap jitters a pixel or two, and a 1px wobble used to save a hand-made crop
// that locked the photo out of automatic framing. A drag only counts once the
// finger is more than DRAG_SLOP px from where it landed.
export const DRAG_SLOP = 4;
export const isDrag = (from, to) => Math.hypot(to.x - from.x, to.y - from.y) > DRAG_SLOP;

// Apply a crop change from the owner's hands ({ crop, touched } → next state).
// Only a change that really moves or zooms the photo makes it theirs: zooming
// out at the widest, or pushing against the photo's edge, leaves it automatic.
export const reframe = (f, next) => {
    if (!f.crop || !next) return f;
    const same = ['x', 'y', 'w', 'h'].every((k) => Math.abs(next[k] - f.crop[k]) < 1e-6);
    return same ? f : { crop: next, touched: true };
};

// Keep a crop inside the photo.
const contain = (c) => ({ ...c, x: clamp(c.x, 0, 1 - c.w), y: clamp(c.y, 0, 1 - c.h) });
const zoomOf = (c, ratio) => maxCrop(c.ar, ratio).w / c.w;
// Zoom to `z`, keeping the photo point under (fx, fy) — fractions of the frame — where it is.
const zoomTo = (c, z, ratio, fx = 0.5, fy = 0.5) => {
    const base = maxCrop(c.ar, ratio);
    const zz = clamp(z, 1, MAX_ZOOM);
    const w = base.w / zz, h = base.h / zz;
    return contain({ ...c, w, h, x: c.x + fx * c.w - fx * w, y: c.y + fy * c.h - fy * h });
};

const chip = (on) => ({
    padding: '0.45rem 0.8rem', borderRadius: 'var(--radius-pill)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
    border: on ? '1.5px solid #fff' : '1px solid rgba(255,255,255,0.3)', background: on ? 'rgba(255,255,255,0.12)' : 'transparent', color: '#fff',
});
const textBtn = { background: 'none', border: 'none', color: '#fff', fontSize: '0.9rem', cursor: 'pointer', padding: '0.5rem', fontFamily: 'var(--font-body)' };

const PhotoEditor = ({ url, edit, shape: startShape, isCover, onDone, onCancel, onRemove }) => {
    const [shape, setShape] = useState(startShape || '1:1');
    const ratio = ratioOf(shape);
    const [tab, setTab] = useState('crop');
    // crop: {x, y, w, h, ar} once the photo has loaded. touched: framed by hand?
    // An untouched photo saves no crop and keeps automatic framing, which also
    // re-flows by itself if the post shape changes later. One state, so a
    // gesture updates both together.
    const [framing, setFraming] = useState(() => ({ crop: null, touched: hasCrop(edit) }));
    const { crop, touched } = framing;
    const [adj, setAdj] = useState(() => Object.fromEntries(ADJUSTMENTS.map((a) => [a.key, edit?.[a.key] || 0])));
    const [stage, setStage] = useState({ w: 0, h: 0 });
    const [failed, setFailed] = useState(false);
    const stageRef = useRef(null);
    const frameRef = useRef(null);
    const pointers = useRef(new Map());
    const pinch = useRef(null);
    const warmthId = useFilterId();
    const src = cloudinaryPhoto(url, 1600);
    const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

    // Load the photo to learn its shape, then start from the saved framing (or the default).
    useEffect(() => {
        let live = true;
        const im = new Image();
        im.onload = () => {
            if (!live) return;
            const ar = im.naturalWidth / im.naturalHeight;
            let start = defaultCrop(ar, ratio);
            if (hasCrop(edit)) {
                const c = { x: edit.x, y: edit.y, w: edit.w, h: edit.h, ar };
                start = Math.abs((ratio * c.h) / c.w - ar) / ar < 0.02 ? contain(c) : fitCrop(c, ratio);
            }
            setFraming((f) => ({ ...f, crop: start }));
        };
        im.onerror = () => live && setFailed(true);
        im.src = src;
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src]);

    useLayoutEffect(() => {
        const el = stageRef.current;
        if (!el) return undefined;
        const ro = new ResizeObserver(([entry]) => setStage({ w: entry.contentRect.width, h: entry.contentRect.height }));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Keep the page behind still; Escape backs out.
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
        window.addEventListener('keydown', onKey);
        return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
    }, [onCancel]);

    const pad = 20;
    const availW = Math.max(0, stage.w - pad * 2), availH = Math.max(0, stage.h - pad * 2);
    const frame = availW / Math.max(1, availH) > ratio ? { w: availH * ratio, h: availH } : { w: availW, h: availW / ratio };

    const frameFraction = (clientX, clientY) => {
        const r = frameRef.current?.getBoundingClientRect();
        if (!r || !r.width) return [0.5, 0.5];
        return [clamp((clientX - r.left) / r.width, 0, 1), clamp((clientY - r.top) / r.height, 0, 1)];
    };
    // Every move or zoom goes through here, so it's framed by hand only if the crop really changed.
    const change = (fn) => setFraming((f) => reframe(f, f.crop && fn(f.crop)));
    const pan = (dx, dy) => change((c) => contain({ ...c, x: c.x - (dx * c.w) / Math.max(1, frame.w), y: c.y - (dy * c.h) / Math.max(1, frame.h) }));

    // Scroll / trackpad pinch to zoom. Native + non-passive so the page doesn't scroll instead.
    useEffect(() => {
        const el = stageRef.current;
        if (!el) return undefined;
        const onWheel = (e) => {
            if (tab !== 'crop') return;
            e.preventDefault();
            const [fx, fy] = frameFraction(e.clientX, e.clientY);
            change((c) => zoomTo(c, zoomOf(c, ratio) * Math.exp(-e.deltaY * 0.0015), ratio, fx, fy));
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [tab, ratio]);

    const onPointerDown = (e) => {
        if (tab !== 'crop' || !crop) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        pinch.current = null; // re-baseline whenever a finger lands or lifts
    };
    const onPointerMove = (e) => {
        const pts = pointers.current;
        const prev = pts.get(e.pointerId);
        if (!prev || !crop) return;
        const at = { x: e.clientX, y: e.clientY };
        if (pts.size === 1) {
            // Nothing moves until it's a real drag, so a tap can't frame the photo.
            if (!prev.dragging && !isDrag(prev, at)) return;
            pts.set(e.pointerId, { ...at, dragging: true });
            pan(at.x - prev.x, at.y - prev.y);
            return;
        }
        pts.set(e.pointerId, at);
        const [a, b] = [...pts.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const g = pinch.current;
        if (!g) { pinch.current = { dist, mid, zoom: zoomOf(crop, ratio) }; return; }
        // Two resting fingers jitter too: wait for a real pinch or slide.
        if (!g.live && Math.abs(dist - g.dist) <= DRAG_SLOP && !isDrag(g.mid, mid)) return;
        g.live = true;
        const [fx, fy] = frameFraction(mid.x, mid.y);
        const dx = mid.x - g.mid.x, dy = mid.y - g.mid.y;
        g.mid = mid;
        change((c) => {
            const z = zoomTo(c, (g.zoom * dist) / Math.max(1, g.dist), ratio, fx, fy);
            return contain({ ...z, x: z.x - (dx * z.w) / Math.max(1, frame.w), y: z.y - (dy * z.h) / Math.max(1, frame.h) });
        });
    };
    const onPointerUp = (e) => { pointers.current.delete(e.pointerId); pinch.current = null; };

    const onStageKey = (e) => {
        if (tab !== 'crop' || !crop) return;
        const step = e.shiftKey ? 40 : 10;
        const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
        if (moves[e.key]) { e.preventDefault(); pan(...moves[e.key]); }
        if (e.key === '+' || e.key === '=') { e.preventDefault(); change((c) => zoomTo(c, zoomOf(c, ratio) * 1.1, ratio)); }
        if (e.key === '-') { e.preventDefault(); change((c) => zoomTo(c, zoomOf(c, ratio) / 1.1, ratio)); }
    };

    const changeShape = (id) => {
        if (id === shape) return;
        const r = ratioOf(id);
        setShape(id);
        // A hand-made framing re-fits; an automatic one stays automatic.
        setFraming((f) => (f.crop ? { ...f, crop: f.touched ? fitCrop(f.crop, r) : defaultCrop(f.crop.ar, r) } : f));
    };
    // Back to automatic framing: no crop is saved.
    const resetCrop = () => setFraming((f) => ({ crop: f.crop && defaultCrop(f.crop.ar, ratio), touched: false }));

    const result = () => {
        const out = { url };
        if (crop && touched) Object.assign(out, { x: round4(crop.x), y: round4(crop.y), w: round4(crop.w), h: round4(crop.h), ar: round4(crop.ar) });
        ADJUSTMENTS.forEach(({ key }) => { if (adj[key]) out[key] = adj[key]; });
        return { edit: Object.keys(out).length > 1 ? out : null, shape };
    };

    const zoom = crop ? zoomOf(crop, ratio) : 1;
    const adjusted = ADJUSTMENTS.some(({ key }) => adj[key]);

    return (
        <div role="dialog" aria-modal="true" aria-label="Edit photo" data-testid="photo-editor"
            style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(4,5,5,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 'min(100%, 520px)', height: 'min(100dvh, 920px)', background: '#040505', color: '#fff', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-body)', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
                <div style={{ height: '52px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.5rem' }}>
                    <button type="button" onClick={onCancel} style={textBtn} data-testid="photo-editor-cancel">Cancel</button>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem', margin: 0, color: '#fff' }}>Edit photo</h2>
                    <button type="button" onClick={() => onDone(result())} disabled={!crop} style={{ ...textBtn, color: 'var(--gold)', fontWeight: 700, opacity: crop ? 1 : 0.5 }} data-testid="photo-editor-done">Done</button>
                </div>

                <div ref={stageRef} tabIndex={0} onKeyDown={onStageKey} aria-label="Photo. Drag to move, use the zoom slider to zoom."
                    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
                    style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', background: '#111', touchAction: 'none', userSelect: 'none', cursor: tab === 'crop' && crop ? 'grab' : 'default', outline: 'none' }}>
                    {adj.warmth ? <WarmthFilter id={warmthId} warmth={adj.warmth} /> : null}
                    {failed ? (
                        <p style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem', padding: '1rem', textAlign: 'center' }}>Couldn’t load this photo. Check your connection and try again.</p>
                    ) : !crop || !frame.w ? (
                        <p style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem' }}>Loading photo…</p>
                    ) : (
                        // The photo spills past the frame (dimmed) so the owner sees what's cut off.
                        <div ref={frameRef} style={{ position: 'absolute', left: (stage.w - frame.w) / 2, top: (stage.h - frame.h) / 2, width: frame.w, height: frame.h }}>
                            <img src={src} alt="" draggable={false} style={{ position: 'absolute', ...cropBox(crop), filter: photoFilter(adj, warmthId), pointerEvents: 'none', WebkitUserDrag: 'none' }} />
                            <div style={{ position: 'absolute', inset: 0, boxShadow: '0 0 0 9999px rgba(4,5,5,0.62)', border: '2px solid #fff', pointerEvents: 'none' }} />
                            {tab === 'crop' && (
                                <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
                                    {[1, 2].map((k) => <line key={`v${k}`} x1={`${(k * 100) / 3}%`} x2={`${(k * 100) / 3}%`} y1="0" y2="100%" stroke="rgba(255,255,255,0.45)" strokeWidth="1" />)}
                                    {[1, 2].map((k) => <line key={`h${k}`} y1={`${(k * 100) / 3}%`} y2={`${(k * 100) / 3}%`} x1="0" x2="100%" stroke="rgba(255,255,255,0.45)" strokeWidth="1" />)}
                                </svg>
                            )}
                        </div>
                    )}
                    {tab === 'crop' && crop && (
                        <span style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', padding: '0.3rem 0.7rem', borderRadius: 'var(--radius-pill)', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '0.72rem', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                            {coarse ? 'Drag to move · pinch to zoom' : 'Drag to move · scroll to zoom'}
                        </span>
                    )}
                </div>

                <div style={{ flexShrink: 0, padding: '0.9rem 1rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    {tab === 'crop' ? (
                        <>
                            {/* Always there (one box, two messages), so the frame never jumps mid-drag. */}
                            <p data-testid="photo-framing-note" style={{ margin: 0, minHeight: '2.6em', lineHeight: 1.3, textAlign: 'center', fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)' }}>
                                {touched ? (
                                    <><strong style={{ color: '#fff' }}>Framed by you.</strong> Clients see exactly this. Reset goes back to automatic framing.</>
                                ) : (
                                    <><strong style={{ color: 'var(--gold)' }}>Automatic framing.</strong> Clients see this photo cropped around its subject until you move or zoom it.</>
                                )}
                            </p>
                            <div role="radiogroup" aria-label="Post shape" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                                {SHAPES.map((s) => (
                                    <button key={s.id} type="button" role="radio" aria-checked={shape === s.id} onClick={() => changeShape(s.id)} style={chip(shape === s.id)} data-testid={`photo-shape-${s.id}`}>
                                        {s.id === '1:1' ? 'Square 1:1' : s.label}
                                    </button>
                                ))}
                            </div>
                            {shape !== startShape && (
                                <p style={{ margin: 0, textAlign: 'center', fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)' }}>The shape is for your whole post. Your other photos keep their framing in the new shape.</p>
                            )}
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem' }}>
                                Zoom
                                <input type="range" min="1" max={MAX_ZOOM} step="0.01" value={zoom} disabled={!crop} data-testid="photo-zoom"
                                    onChange={(e) => { const z = Number(e.target.value); change((c) => zoomTo(c, z, ratio)); }}
                                    style={{ flex: 1, accentColor: '#fff' }} />
                                <button type="button" onClick={resetCrop} disabled={!touched} style={{ ...textBtn, fontSize: '0.8rem', padding: '0.25rem', opacity: touched ? 1 : 0.4 }}>Reset</button>
                            </label>
                        </>
                    ) : (
                        <>
                            {ADJUSTMENTS.map(({ key, label }) => (
                                <label key={key} style={{ display: 'grid', gridTemplateColumns: '84px 1fr 34px', alignItems: 'center', gap: '0.6rem', fontSize: '0.8rem' }}>
                                    {label}
                                    <input type="range" min="-100" max="100" step="1" value={adj[key]} data-testid={`photo-adj-${key}`}
                                        onChange={(e) => setAdj((a) => ({ ...a, [key]: Number(e.target.value) }))}
                                        onDoubleClick={() => setAdj((a) => ({ ...a, [key]: 0 }))}
                                        style={{ accentColor: '#fff' }} />
                                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: adj[key] ? '#fff' : 'rgba(255,255,255,0.5)' }}>{adj[key] > 0 ? `+${adj[key]}` : adj[key]}</span>
                                </label>
                            ))}
                            <button type="button" onClick={() => setAdj(Object.fromEntries(ADJUSTMENTS.map((a) => [a.key, 0])))} disabled={!adjusted}
                                style={{ ...textBtn, alignSelf: 'center', fontSize: '0.8rem', padding: '0.25rem', opacity: adjusted ? 1 : 0.4 }}>Reset adjustments</button>
                        </>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                        {!isCover && (
                            <button type="button" onClick={() => onDone({ ...result(), makeCover: true })} disabled={!crop} style={{ ...textBtn, fontSize: '0.8rem', padding: '0.25rem', textDecoration: 'underline' }} data-testid="photo-make-cover">Make this the cover</button>
                        )}
                        <button type="button" onClick={() => { if (window.confirm('Remove this photo from your portfolio?')) onRemove(); }} style={{ ...textBtn, fontSize: '0.8rem', padding: '0.25rem', color: '#ff8a70', textDecoration: 'underline' }} data-testid="photo-remove">Remove photo</button>
                    </div>
                </div>

                <div role="tablist" style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid rgba(255,255,255,0.12)' }}>
                    {[['crop', 'Crop'], ['adjust', 'Adjust']].map(([id, label]) => (
                        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`photo-tab-${id}`}
                            style={{ padding: '0.85rem', background: 'none', border: 'none', borderTop: `2px solid ${tab === id ? '#fff' : 'transparent'}`, color: tab === id ? '#fff' : 'rgba(255,255,255,0.5)', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default PhotoEditor;

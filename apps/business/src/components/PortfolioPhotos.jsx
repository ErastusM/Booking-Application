import React, { useCallback, useEffect, useRef, useState } from 'react';
import PhotoFrame, { SHAPES, ratioOf, hasCrop, fitCrop } from './PhotoFrame';
import PhotoEditor from './PhotoEditor';

// The owner's portfolio = their post on the Bookplus feed (Instagram-style):
// one post shape for every photo, each photo framed and adjusted in the
// editor, hold-and-drag to reorder, the first photo is the cover.
//
// `portfolio` is { images, instagramUrl, shape, edits: { [url]: edit } };
// `onSave(next, okMessage)` persists it (and rolls back on failure).

export const MAX_PHOTOS = 30;

const move = (list, from, to) => {
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
};

// Every photo's framing re-fitted to a new post shape (same centre and zoom).
// A crop that can't be re-fitted falls back to automatic framing; adjustments stay.
export const refitEdits = (edits, ratio) => Object.fromEntries(Object.entries(edits || {}).map(([url, e]) => {
    if (!hasCrop(e)) return [url, e];
    const fitted = fitCrop(e, ratio);
    if (fitted) return [url, fitted];
    const { x, y, w, h, ar, ...rest } = e; // eslint-disable-line no-unused-vars
    return [url, rest];
}));

const PENCIL = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
);

const PortfolioPhotos = ({ portfolio, onSave, onAddFiles, uploading }) => {
    const { images, shape = '1:1', edits = {} } = portfolio;
    const [editing, setEditing] = useState(null); // index of the photo open in the editor
    const [drag, setDrag] = useState(null); // { from, over } while a photo is being moved
    const press = useRef(null);
    // Set when a drag ends: the click the browser may still send for that press
    // (a mouse drag dropped back on its own tile) is not a tap. The next press clears it.
    const dragJustEnded = useRef(false);
    const inputRef = useRef(null);
    const order = drag ? move(images, drag.from, drag.over) : images;
    const closeEditor = useCallback(() => setEditing(null), []);

    // Stop any half-finished press when the component goes away.
    useEffect(() => () => press.current?.cleanup?.(), []);

    const changeShape = (id) => {
        if (id === shape) return;
        onSave({ ...portfolio, shape: id, edits: refitEdits(edits, ratioOf(id)) }, 'Post shape updated.');
    };

    // Tap = edit. Hold (touch) or press-and-move (mouse) = pick the photo up;
    // it follows the finger across the grid and drops where it's released.
    // The tap itself is handled by the tile's click, not here on pointerup: the
    // browser sends that click after pointerup at the same spot, so an editor
    // opened on pointerup took the click on whatever control appeared under the
    // finger — on a phone, tapping the third photo in a row hit "Remove photo".
    const onTileDown = (e, i) => {
        if (e.button !== undefined && e.button !== 0) return;
        dragJustEnded.current = false;
        press.current?.cleanup?.();
        const p = { i, x: e.clientX, y: e.clientY, id: e.pointerId, mouse: e.pointerType === 'mouse', active: false, over: i };
        const lift = () => { p.active = true; setDrag({ from: i, over: i }); navigator.vibrate?.(8); };
        const onMove = (ev) => {
            if (ev.pointerId !== p.id) return;
            if (!p.active) {
                if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < 8) return;
                if (!p.mouse) { p.cleanup(); return; } // moved before the hold: it's a scroll
                lift();
            }
            const slot = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-photo-slot]');
            if (slot) {
                p.over = Number(slot.dataset.photoSlot);
                setDrag((d) => (d && d.over !== p.over ? { ...d, over: p.over } : d));
            }
        };
        const onUp = (ev) => {
            if (ev.pointerId !== p.id) return;
            const { active, over } = p;
            p.cleanup();
            if (active) {
                dragJustEnded.current = true;
                setDrag(null);
                if (over !== i) {
                    const next = move(images, i, over);
                    onSave({ ...portfolio, images: next }, over === 0 || i === 0 ? 'Cover photo updated.' : 'Order saved.');
                }
            }
        };
        const onCancel = () => { p.cleanup(); setDrag(null); };
        // While a photo is held, a finger slide must move it rather than scroll the page.
        const noScroll = (ev) => { if (p.active) ev.preventDefault(); };
        p.cleanup = () => {
            clearTimeout(p.timer);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onCancel);
            window.removeEventListener('touchmove', noScroll);
            if (press.current === p) press.current = null;
        };
        if (!p.mouse) p.timer = setTimeout(lift, 350);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        window.addEventListener('touchmove', noScroll, { passive: false });
        press.current = p;
    };

    const saveEdit = (i, { edit, shape: nextShape, makeCover }) => {
        const url = images[i];
        let nextEdits = nextShape !== shape ? refitEdits(edits, ratioOf(nextShape)) : { ...edits };
        if (edit) nextEdits[url] = edit; else delete nextEdits[url];
        const nextImages = makeCover && i > 0 ? [url, ...images.filter((_, k) => k !== i)] : images;
        setEditing(null);
        onSave({ ...portfolio, images: nextImages, shape: nextShape, edits: nextEdits }, makeCover ? 'Cover photo updated.' : 'Photo saved.');
    };
    const removePhoto = (i) => {
        const url = images[i];
        const nextEdits = { ...edits };
        delete nextEdits[url];
        setEditing(null);
        onSave({ ...portfolio, images: images.filter((_, k) => k !== i), edits: nextEdits }, 'Photo removed.');
    };

    return (
        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--charcoal)', margin: 0 }}>Photos ({images.length}/{MAX_PHOTOS})</h3>
                <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading || images.length >= MAX_PHOTOS} className="btn-primary" style={{ padding: '0.5rem 1.1rem', fontSize: '0.875rem' }} data-testid="portfolio-add">
                    {uploading ? 'Uploading…' : '+ Add photos'}
                </button>
            </div>
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple onChange={(e) => { onAddFiles(Array.from(e.target.files || [])); e.target.value = ''; }} style={{ display: 'none' }} data-testid="portfolio-file" />

            <div>
                <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--charcoal)', marginBottom: '0.4rem' }}>Post shape</span>
                <div role="radiogroup" aria-label="Post shape" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem', maxWidth: '420px' }}>
                    {SHAPES.map((s) => (
                        <button key={s.id} type="button" role="radio" aria-checked={shape === s.id} onClick={() => changeShape(s.id)} data-testid={`portfolio-shape-${s.id}`}
                            style={{ padding: '0.5rem 0.25rem', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', background: 'var(--card-bg)', color: 'var(--charcoal)', border: shape === s.id ? '2px solid var(--charcoal)' : '1px solid var(--border)', fontFamily: 'var(--font-body)' }}>
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>

            {images.length === 0 ? (
                <div onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
                    style={{ border: '2px dashed var(--border)', borderRadius: 'var(--radius-sm)', padding: '2.5rem 1rem', textAlign: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🖼️</div>
                    <p style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Add your images here</p>
                    <p style={{ fontSize: '0.8rem' }}>JPG, PNG, AVIF, WEBP · max 10 MB each</p>
                </div>
            ) : (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(30%, 150px), 1fr))', gap: '0.4rem' }}>
                        {order.map((url, k) => {
                            const i = images.indexOf(url);
                            const lifted = drag && drag.from === i;
                            return (
                                <div key={url} data-photo-slot={k} role="button" tabIndex={0} aria-label={`Photo ${k + 1}${k === 0 ? ', cover' : ''}. Edit`} data-testid="portfolio-photo"
                                    onPointerDown={(e) => onTileDown(e, i)}
                                    onClick={() => { if (dragJustEnded.current) dragJustEnded.current = false; else setEditing(i); }}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(i); } }}
                                    onContextMenu={(e) => e.preventDefault()}
                                    style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', cursor: drag ? 'grabbing' : 'pointer', touchAction: 'manipulation', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
                                        transform: lifted ? 'scale(1.06)' : 'none', boxShadow: lifted ? 'var(--shadow-lg)' : 'none', outline: lifted ? '2px solid var(--gold)' : 'none', zIndex: lifted ? 2 : 'auto', opacity: drag && !lifted ? 0.85 : 1, transition: 'transform 120ms, box-shadow 120ms' }}>
                                    <PhotoFrame src={url} width={400} shape={shape} edit={edits[url]} alt="" imgProps={{ loading: k < 9 ? 'eager' : 'lazy', decoding: 'async' }} />
                                    {k === 0 && <span style={{ position: 'absolute', top: '6px', left: '6px', padding: '2px 7px', borderRadius: 'var(--radius-pill)', background: '#040505', color: '#fff', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.02em', pointerEvents: 'none' }}>COVER</span>}
                                    <span style={{ position: 'absolute', bottom: '6px', right: '6px', width: '26px', height: '26px', borderRadius: '50%', background: 'rgba(4,5,5,0.7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>{PENCIL}</span>
                                </div>
                            );
                        })}
                    </div>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Tap a photo to crop, zoom or adjust it. Hold and drag to reorder. The first one is your cover.</p>
                </>
            )}

            {editing != null && images[editing] && (
                <PhotoEditor
                    key={images[editing]}
                    url={images[editing]}
                    edit={edits[images[editing]]}
                    shape={shape}
                    isCover={editing === 0}
                    onCancel={closeEditor}
                    onDone={(r) => saveEdit(editing, r)}
                    onRemove={() => removePhoto(editing)}
                />
            )}
        </div>
    );
};

export default PortfolioPhotos;

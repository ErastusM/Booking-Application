import React, { useEffect, useRef } from 'react';

/**
 * The sheet a drag has to pass through before anything is rescheduled.
 *
 * Two shapes, one component, because they are the same question asked at
 * different widths:
 *
 *   confirm — the slot was clear. "Move this booking?" with one action.
 *   clash   — the slot was taken. The ways out, each spelling out exactly who
 *             ends up where, with impossible routes shown disabled and the
 *             reason given, so a missing option is never unexplained.
 *
 * Nothing here decides for the provider, and nothing is written until an option
 * is chosen. Releasing the card is a proposal, not an instruction.
 */
const ConflictSheet = ({ sheet, fmt, onChoose, onCancel, busy }) => {
    const panelRef = useRef(null);
    const firstRef = useRef(null);

    useEffect(() => {
        if (sheet && firstRef.current) firstRef.current.focus();
    }, [sheet]);

    useEffect(() => {
        if (!sheet) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [sheet, onCancel]);

    if (!sheet) return null;

    const { item, place, hits, routes, kind } = sheet;
    const confirming = kind === 'confirm';
    const names = hits.map((h) => h.label);
    const nameList = names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

    const title = confirming ? 'Move this booking?' : 'That time is already booked';

    let assigned = false;
    const takeFirst = (enabled) => {
        if (assigned || !enabled) return undefined;
        assigned = true;
        return firstRef;
    };

    return (
        <>
            <div
                onClick={onCancel}
                aria-hidden="true"
                style={{
                    position: 'absolute', inset: 0, zIndex: 60,
                    background: 'rgba(4,5,5,0.38)',
                }}
            />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                style={{
                    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 61,
                    background: 'var(--card-bg)', borderTop: '1px solid var(--border)',
                    borderRadius: '14px 14px 0 0', padding: '0.9rem 1rem 1rem',
                    display: 'flex', flexDirection: 'column', gap: '0.7rem',
                    maxHeight: '92%', overflowY: 'auto',
                    boxShadow: '0 -12px 30px -12px rgba(4,5,5,0.4)',
                }}
            >
                <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 700, color: 'var(--charcoal)' }}>
                    {title}
                </h3>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    <strong style={{ color: 'var(--charcoal)' }}>{item.label}</strong>{' '}
                    {confirming ? (
                        <>
                            would move to{' '}
                            <span className="tnum" style={{ color: 'var(--charcoal)' }}>{fmt(place.startMin)} – {fmt(place.endMin)}</span>.
                            Nothing changes until you confirm, and the client is only told once it does.
                        </>
                    ) : (
                        <>
                            at <span className="tnum" style={{ color: 'var(--charcoal)' }}>{fmt(place.startMin)} – {fmt(place.endMin)}</span>{' '}
                            runs over {nameList}. Choose what happens to {names.length === 1 ? 'them' : 'each of them'}.
                        </>
                    )}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {routes.map((r) => {
                        const enabled = !!r.plan && !busy;
                        return (
                            <button
                                key={r.key}
                                ref={takeFirst(enabled)}
                                type="button"
                                disabled={!enabled}
                                onClick={() => onChoose(r)}
                                style={{
                                    display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '0.6rem',
                                    textAlign: 'left', font: 'inherit', fontSize: '0.82rem',
                                    padding: '0.55rem 0.7rem', borderRadius: '10px',
                                    border: `1px solid ${r.primary && r.plan ? 'var(--gold)' : 'var(--border)'}`,
                                    background: 'var(--card-bg)', color: 'var(--charcoal)',
                                    cursor: enabled ? 'pointer' : 'not-allowed',
                                    opacity: enabled ? 1 : 0.45,
                                }}
                            >
                                <span style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                                    <span>{r.label}</span>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                        {r.plan ? (r.detail || []).join(' · ') : r.reason}
                                    </span>
                                </span>
                                <span style={{
                                    fontFamily: 'var(--font-display)', fontSize: '0.58rem', fontWeight: 700,
                                    letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
                                    color: r.primary && r.plan ? 'var(--gold)' : 'var(--text-muted)',
                                }}>
                                    {r.tag}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <button
                    type="button"
                    onClick={onCancel}
                    style={{
                        alignSelf: 'center', background: 'none', border: 0, padding: '0.3rem',
                        font: 'inherit', fontFamily: 'var(--font-display)', fontSize: '0.78rem',
                        fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer',
                    }}
                >
                    {confirming ? 'Cancel' : 'Put it back where it was'}
                </button>
            </div>
        </>
    );
};

export default ConflictSheet;

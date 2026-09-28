import React, { useEffect, useState } from 'react';
import { deleteDialog } from '../utils/adminPanel';

// Admin → Users → Delete. Says what will happen, in numbers, before it does.
// Deleting a business owner needs DELETE typed out; a client is one click.
// `loadPreview()` resolves GET /users/:id/delete-preview's data.
const DeleteUserDialog = ({ user, loadPreview, onConfirm, onClose, busy = false }) => {
    const [preview, setPreview] = useState(null);
    const [typed, setTyped] = useState('');
    const text = deleteDialog(user, preview);

    useEffect(() => {
        let alive = true;
        loadPreview().then((p) => { if (alive) setPreview(p); }).catch(() => {});
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?._id]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, busy]);

    const ready = !busy && (!text.requireTyping || typed.trim() === text.requireTyping);

    return (
        <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,5,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }}>
            <div role="alertdialog" aria-modal="true" aria-labelledby="delete-user-title" data-testid="delete-user-dialog" onClick={(e) => e.stopPropagation()}
                style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', width: '100%', maxWidth: '460px', overflow: 'hidden' }}>
                <div style={{ padding: '1.2rem 1.35rem 0.4rem' }}>
                    <h2 id="delete-user-title" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 600, color: 'var(--danger-fg)', margin: 0 }}>{text.title}</h2>
                </div>
                <div style={{ padding: '0.5rem 1.35rem 1.1rem', color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.55 }}>
                    <p style={{ margin: 0 }}>{text.intro}</p>
                    {text.bullets.length > 0 && (
                        <ul style={{ margin: '0.6rem 0 0', paddingLeft: '1.15rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                            {text.bullets.map((b) => <li key={b}>{b}</li>)}
                        </ul>
                    )}
                    {text.requireTyping && (
                        <label style={{ display: 'block', marginTop: '1rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Type {text.requireTyping} to confirm
                            <input
                                autoFocus
                                value={typed}
                                onChange={(e) => setTyped(e.target.value)}
                                aria-label={`Type ${text.requireTyping} to confirm`}
                                className="input"
                                autoComplete="off"
                                spellCheck={false}
                                style={{ width: '100%', marginTop: '0.4rem', letterSpacing: '0.08em' }}
                            />
                        </label>
                    )}
                    <p style={{ margin: '0.9rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>This can’t be undone.</p>
                </div>
                <div style={{ padding: '0.9rem 1.35rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button type="button" onClick={onClose} disabled={busy} className="btn-outline" style={{ padding: '0.55rem 1.1rem' }}>Cancel</button>
                    <button type="button" onClick={onConfirm} disabled={!ready} style={{
                        padding: '0.55rem 1.1rem', borderRadius: 'var(--radius-sm)', border: 'none',
                        background: '#b91c1c', color: '#fff', fontWeight: 600, fontFamily: 'var(--font-body)',
                        fontSize: '0.88rem', cursor: ready ? 'pointer' : 'not-allowed', opacity: ready ? 1 : 0.45,
                    }}>{busy ? 'Deleting…' : text.confirmLabel}</button>
                </div>
            </div>
        </div>
    );
};

export default DeleteUserDialog;

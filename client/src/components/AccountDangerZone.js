import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';

// Self-service account controls shared by clients and providers: manage blocked
// users, deactivate (reversible) or delete (irreversible) the account.
const AccountDangerZone = () => {
    const { logout } = useAuthContext();
    const navigate = useNavigate();
    const [blocked, setBlocked] = useState([]);
    const [confirm, setConfirm] = useState(null); // 'deactivate' | 'delete'
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        authService.getBlockedUsers().then((r) => setBlocked(r.data.data || [])).catch(() => {});
    }, []);

    const unblock = async (id) => {
        try { await authService.unblockUser(id); setBlocked((b) => b.filter((u) => u._id !== id)); }
        catch { /* ignore */ }
    };

    const endSession = async () => { try { await logout(); } finally { navigate('/'); } };

    const doDeactivate = async () => {
        setBusy(true); setError('');
        try { await authService.deactivateAccount(); await endSession(); }
        catch (e) { setError(e.response?.data?.message || 'Could not deactivate'); setBusy(false); }
    };

    const doDelete = async () => {
        setBusy(true); setError('');
        try { await authService.deleteAccount(password); await endSession(); }
        catch (e) { setError(e.response?.data?.message || 'Could not delete account'); setBusy(false); }
    };

    const card = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.25rem 1.5rem', marginTop: '1.5rem' };
    const h = { fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)', margin: '0 0 0.75rem' };

    return (
        <div>
            {/* Blocked users */}
            <div style={card}>
                <h3 style={h}>Blocked users</h3>
                {blocked.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>You haven’t blocked anyone. Blocking stops bookings and messages between you both.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {blocked.map((u) => (
                            <div key={u._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                                <span style={{ fontSize: '0.9rem', color: 'var(--charcoal)' }}>{u.name} <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>· {u.role}</span></span>
                                <button onClick={() => unblock(u._id)} className="btn-outline" style={{ padding: '0.3rem 0.8rem', fontSize: '0.78rem' }}>Unblock</button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Danger zone */}
            <div style={{ ...card, borderColor: '#f3c2c2' }}>
                <h3 style={{ ...h, color: '#b91c1c' }}>Account</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                    <button onClick={() => { setConfirm('deactivate'); setError(''); }} className="btn-outline" style={{ padding: '0.55rem 1.1rem', fontSize: '0.85rem' }}>Deactivate account</button>
                    <button onClick={() => { setConfirm('delete'); setError(''); }} style={{ padding: '0.55rem 1.1rem', fontSize: '0.85rem', borderRadius: 'var(--radius-sm)', border: '1px solid #dc2626', background: '#fff', color: '#dc2626', cursor: 'pointer', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: '600' }}>Delete account</button>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
                    Deactivating hides your account and signs you out — sign in again any time to reactivate. Deleting is permanent: your personal details are removed and you can’t sign back in.
                </p>
            </div>

            {/* Confirmation modal */}
            {confirm && (
                <div onClick={() => !busy && setConfirm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,5,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }}>
                    <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', width: '100%', maxWidth: '420px', padding: '1.5rem' }}>
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: '700', color: 'var(--charcoal)', margin: '0 0 0.5rem' }}>
                            {confirm === 'delete' ? 'Delete your account?' : 'Deactivate your account?'}
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
                            {confirm === 'delete'
                                ? 'This permanently removes your personal information and disables sign-in. This cannot be undone.'
                                : 'You’ll be signed out. Sign in again whenever you like to reactivate your account.'}
                        </p>
                        {confirm === 'delete' && (
                            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Confirm your password (if you have one)" className="input" style={{ width: '100%', marginBottom: '1rem' }} autoComplete="current-password" />
                        )}
                        {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{error}</p>}
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button onClick={() => setConfirm(null)} disabled={busy} className="btn-outline" style={{ padding: '0.6rem 1.1rem' }}>Cancel</button>
                            <button onClick={confirm === 'delete' ? doDelete : doDeactivate} disabled={busy} style={{ padding: '0.6rem 1.3rem', borderRadius: 'var(--radius-sm)', border: 'none', background: confirm === 'delete' ? '#dc2626' : 'var(--charcoal)', color: 'white', cursor: 'pointer', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: '700' }}>
                                {busy ? 'Please wait…' : confirm === 'delete' ? 'Delete forever' : 'Deactivate'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AccountDangerZone;

import React, { useEffect, useState } from 'react';
import { getPushState, enablePush, disablePush } from '../utils/push';

// Self-contained push-notification opt-in toggle. Renders nothing when
// push is unsupported by the browser or not enabled on the server.
const PushToggle = () => {
    const [state, setState] = useState({ supported: false, enabled: false, subscribed: false });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { getPushState().then(setState); }, []);

    if (!state.supported || !state.enabled) return null;

    const toggle = async () => {
        setBusy(true);
        setError('');
        try {
            if (state.subscribed) { await disablePush(); setState(s => ({ ...s, subscribed: false })); }
            else { await enablePush(); setState(s => ({ ...s, subscribed: true })); }
        } catch (err) {
            setError(err.message || 'Could not update notifications');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '1rem 0' }}>
            <div>
                <p style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Push notifications</p>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>Get alerts for bookings, reschedules and reminders on this device.</p>
                {error && <p style={{ fontSize: '0.75rem', color: '#dc2626', margin: '0.3rem 0 0' }}>{error}</p>}
            </div>
            <button onClick={toggle} disabled={busy} aria-label="Toggle push notifications" style={{
                width: '46px', height: '26px', borderRadius: '99px', border: 'none', flexShrink: 0,
                background: state.subscribed ? 'var(--gold)' : 'var(--warm-gray)', cursor: busy ? 'wait' : 'pointer',
                position: 'relative', transition: 'background 0.2s',
            }}>
                <span style={{ position: 'absolute', top: '3px', left: state.subscribed ? '23px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block' }} />
            </button>
        </div>
    );
};

export default PushToggle;

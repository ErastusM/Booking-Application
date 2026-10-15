import React, { useState } from 'react';
import { financeService } from '../services';
import { panel as card, h3, muted, bad, Status } from './admin/ui';

// Money → Settings: "Check the PayGate connection". Proves the server's PayGate
// settings before anyone pays: PayGate accepts the ID and password, signs with
// the key Bookplus checks, and both public addresses answer. It opens a N$5.00
// test session at PayGate that nobody pays (services/paygateCheck in the API).

const RESULT = { ok: ['OK', 'ok'], warn: ['Check', 'warn'], fail: ['Failed', 'bad'], skipped: ['Skipped', undefined] };

const PaygateCheck = ({ onLocked }) => {
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    const run = async () => {
        setBusy(true); setError('');
        try {
            setResult((await financeService.paygateCheck()).data.data);
        } catch (err) {
            if (err?.response?.data?.code === 'mfa_required') onLocked();
            else setError(err?.response?.data?.message || 'The check could not run. Try again.');
        }
        setBusy(false);
    };

    return (
        <div style={card} data-testid="paygate-check">
            <h3 style={{ ...h3, marginBottom: '0.35rem' }}>PayGate connection</h3>
            <p style={muted}>Checks the PayGate settings on the server without taking any money. It opens a N$5.00 test session at PayGate that nobody pays; it shows in PayGate’s MAP as not done.</p>
            <button type="button" className="btn-primary" style={{ marginTop: '0.75rem' }} disabled={busy} onClick={run}>
                {busy ? 'Checking…' : result ? 'Check again' : 'Check the PayGate connection'}
            </button>
            {error && <p role="alert" style={{ ...muted, color: bad, marginTop: '0.6rem' }}>{error}</p>}
            {result && (
                <div style={{ marginTop: '0.85rem' }}>
                    <p style={{ margin: '0 0 0.4rem', fontWeight: 600, color: result.ready ? 'var(--success-fg)' : bad }} data-testid="paygate-check-summary">
                        {result.ready ? 'Everything works.' : `${result.failed || 'Some'} thing${result.failed === 1 ? '' : 's'} to fix before taking payments.`}
                    </p>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {result.items.map((i) => {
                            const [label, tone] = RESULT[i.status] || RESULT.skipped;
                            return (
                                <li key={i.key} style={{ borderTop: '1px solid var(--border)', padding: '0.55rem 0' }} data-testid={`paygate-check-${i.key}`}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'baseline' }}>
                                        <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--charcoal)' }}>{i.label}</span>
                                        <span style={{ flexShrink: 0 }}><Status tone={tone}>{label}</Status></span>
                                    </div>
                                    {i.detail && <p style={{ ...muted, fontSize: '0.8rem', marginTop: '0.2rem', overflowWrap: 'anywhere' }}>{i.detail}</p>}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default PaygateCheck;

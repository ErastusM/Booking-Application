import React, { useCallback, useEffect, useState } from 'react';
import { financeService } from '../services';
import { useToast } from './Toast';
import { Kpis, Status, panel as card, muted, input, label, th, td, small, list } from './admin/ui';

// Admin console → Money → Subscriptions. Who is kept free and who is on a free
// trial (no billing yet), moving a business, and whether businesses see their
// plan. A director makes changes; each one needs a reason for the audit log.

const apiError = (err, fallback) => err?.response?.data?.message || fallback;
const isLocked = (err) => err?.response?.data?.code === 'mfa_required';
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const nad = (cents) => `N$${(cents / 100).toFixed(2)}`;

export const STATUS = {
    exempt: ['Kept free', undefined],
    trialing: ['Free trial', 'info'],
    trial_ended: ['Trial ended', 'warn'],
    active: ['Paying', 'ok'],
    past_due: ['Payment failed', 'warn'],
    paused: ['Paused: unpaid', 'bad'],
    cancelled: ['Plan ended', undefined],
};

const SubscriptionsView = ({ isDirector, onLocked }) => {
    const toast = useToast();
    const [data, setData] = useState(null);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(null);

    const load = useCallback(async () => {
        try {
            setData((await financeService.subscriptions()).data.data);
        } catch (err) {
            if (isLocked(err)) onLocked(); else toast(apiError(err, 'Could not load the subscriptions.'), 'error');
        }
    }, [onLocked, toast]);
    useEffect(() => { load(); }, [load]);

    const act = async (key, call, done) => {
        if (!reason.trim()) { toast('Give a reason first; it goes in the audit log.', 'error'); return; }
        setBusy(key);
        try {
            await call(reason.trim());
            toast(done, 'success');
            setReason('');
            await load();
        } catch (err) {
            if (isLocked(err)) onLocked(); else toast(apiError(err, 'Could not save.'), 'error');
        }
        setBusy(null);
    };

    if (!data) return <p style={muted}>Loading…</p>;
    const c = data.counts || {};
    return (
        <div style={list} data-testid="finance-subscriptions">
            <p style={muted}>
                {data.cardsOn
                    ? 'Businesses add a card to start their plan (the first month is charged then), and the saved card is charged each month after that. A payment that does not go through is tried again for 7 days; then the plan is paused and the business is hidden from clients until it pays.'
                    : 'Billing is not switched on yet: nobody is charged.'}
                {' '}Businesses from before {day(data.startedAt) || 'subscriptions started'} are
                kept free until you move them; new businesses start a free trial when they sign up.
            </p>
            <Kpis items={[
                { label: 'Kept free', value: String(c.exempt || 0) },
                { label: 'On a free trial', value: String(c.trialing || 0) },
                { label: 'Trial ended', value: String(c.trial_ended || 0), sub: 'No card saved yet' },
                { label: 'Paying', value: String(c.active || 0), sub: 'Card saved' },
                { label: 'Payment failed', value: String(c.past_due || 0), sub: 'Being tried again' },
                { label: 'Paused', value: String(c.paused || 0), sub: 'Hidden from clients' },
                { label: 'Plan ended', value: String(c.cancelled || 0) },
            ]} />
            {data.flagged > 0 && (
                <p style={{ ...muted, color: 'var(--danger-fg)' }} role="alert" data-testid="plan-payments-flagged">
                    {data.flagged} plan payment{data.flagged === 1 ? ' needs' : 's need'} checking at PayGate (flagged: paid but not applied, a mismatch, or no answer from PayGate). Look for flagged in SubscriptionPayment and check each one at PayGate before refunding or charging again.
                </p>
            )}

            <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div>
                        <b>Businesses see their plan</b>
                        <p style={muted}>{data.showToBusinesses ? 'On: owners see "Your plan" under Account.' : 'Off: owners see nothing about plans yet.'}</p>
                    </div>
                    {isDirector && (
                        <button type="button" className="btn-outline" style={small} disabled={!!busy}
                            onClick={() => act('vis', (r) => financeService.subscriptionVisibility(!data.showToBusinesses, r), data.showToBusinesses ? 'Hidden from businesses' : 'Shown to businesses')}>
                            {data.showToBusinesses ? 'Hide from businesses' : 'Show to businesses'}
                        </button>
                    )}
                </div>
                {isDirector ? (
                    <div style={{ marginTop: 10 }}>
                        <label style={label} htmlFor="sub-reason">Reason (for any change on this page)</label>
                        <input id="sub-reason" style={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Pilot business agreed to the Basic plan" />
                    </div>
                ) : <p style={{ ...muted, marginTop: 8 }}>Only a director can change these.</p>}
            </div>

            <div className="adm-scroll" style={card}>
                <table className="adm-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th style={th}>Business</th><th style={th}>Joined</th><th style={th}>Status</th>
                            <th style={th}>Trial ends</th><th style={th}>Then pays</th>
                            <th style={th}><span className="sr-only">Actions</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.rows.length === 0 && <tr><td style={td} colSpan={6}>No businesses yet.</td></tr>}
                        {data.rows.map((r) => {
                            const [text, tone] = STATUS[r.status] || [r.status];
                            const id = String(r.provider._id);
                            const shown = r.status === 'trialing' ? `${text}: ${r.trialDaysLeft} day${r.trialDaysLeft === 1 ? '' : 's'} left` : text;
                            return (
                                <tr key={id} data-testid="subscription-row">
                                    <td style={td}><b>{r.provider.name}</b><div style={muted}>{r.provider.email}</div></td>
                                    <td style={td}>{day(r.provider.createdAt)}</td>
                                    <td style={td}>
                                        <Status tone={tone}>{shown}</Status>
                                        {r.card && <div style={muted}>{r.card.brand || 'Card'} ending {r.card.last4}{r.status === 'active' && r.paidThrough ? `, paid to ${day(r.paidThrough)}` : ''}</div>}
                                        {r.status === 'active' && r.cancelAtPeriodEnd && <div style={muted}>Cancelled: ends {day(r.paidThrough)}</div>}
                                        {r.status === 'past_due' && <div style={muted}>{r.nextAttemptAt ? `Next try ${day(r.nextAttemptAt)}, ` : ''}paused on {day(r.graceEndsAt)} if unpaid</div>}
                                    </td>
                                    <td style={td}>{r.status === 'exempt' ? '' : day(r.trialEndsAt)}</td>
                                    <td style={td}>{r.status === 'exempt' ? 'Nothing' : `${nad(r.nextPriceCents)}/month`}</td>
                                    <td style={td}>
                                        {isDirector && (r.status === 'exempt'
                                            ? <button type="button" className="btn-outline" style={small} disabled={!!busy} onClick={() => act(id, (rs) => financeService.subscriptionTrial(id, rs), 'Free trial started')}>Start free trial</button>
                                            : <button type="button" className="btn-outline" style={small} disabled={!!busy} onClick={() => act(id, (rs) => financeService.subscriptionKeepFree(id, rs), 'Kept free')}>Keep free</button>)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default SubscriptionsView;

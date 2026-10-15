import React, { useCallback, useEffect, useState } from 'react';
import { financeService } from '../services';
import { useToast } from './Toast';
import { nad, parseCents } from '../utils/onlinePayment';
import { panel as card, muted, input, small, list, bad as red, Kpis } from './admin/ui';

// Admin console, Money → Dashboard and Costs (payment specification,
// section 15). Dashboard: businesses by plan, what Bookplus kept, what it
// cost, net contribution, break-even against the running costs, and where
// money is made or lost (by booking value, plan and business). Revenue and net
// contribution are always shown apart. Costs: the running costs a director
// enters for each month.

const h3 = { fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.6rem' };
const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem', fontSize: '0.86rem', padding: '0.3rem 0' };
const apiError = (err, fallback) => err?.response?.data?.message || fallback;
const isLocked = (err) => err?.response?.data?.code === 'mfa_required';

// Periods, as Windhoek dates (YYYY-MM-DD).
const ymd = (d) => new Date(d.getTime() + 2 * 3600000).toISOString().slice(0, 10);
const PERIODS = [
    ['month', 'This month', () => { const t = ymd(new Date()); return { from: `${t.slice(0, 7)}-01`, to: t }; }],
    ['last', 'Last month', () => {
        const t = ymd(new Date());
        const first = new Date(`${t.slice(0, 7)}-01T00:00:00Z`);
        const lastEnd = new Date(first.getTime() - 86400000).toISOString().slice(0, 10);
        return { from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd };
    }],
    ['quarter', 'Last 3 months', () => {
        const t = ymd(new Date());
        const d = new Date(`${t.slice(0, 7)}-01T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() - 2);
        return { from: d.toISOString().slice(0, 10), to: t };
    }],
    ['year', 'This year', () => { const t = ymd(new Date()); return { from: `${t.slice(0, 4)}-01-01`, to: t }; }],
];

const Line = ({ k, v, testid, color }) => (
    <div style={row} data-testid={testid}>
        <span style={{ color: 'var(--text-secondary)' }}>{k}</span>
        <span style={{ fontWeight: 600, color: color || 'var(--charcoal)', textAlign: 'right' }}>{v}</span>
    </div>
);

const GroupRows = ({ rows, label }) => (
    <div style={{ display: 'grid', gap: '0.1rem' }}>
        {rows.map((g) => (
            <div key={g.key} style={{ borderTop: '1px solid var(--border)', padding: '0.5rem 0' }} data-testid="dash-group">
                <div style={{ ...row, padding: 0 }}>
                    <span style={{ fontWeight: 600, color: 'var(--charcoal)' }}>{label(g)}</span>
                    <span style={{ fontWeight: 600, color: g.netCents < 0 ? red : 'var(--charcoal)' }}>{nad(g.netCents)}</span>
                </div>
                <p style={{ ...muted, fontSize: '0.76rem' }}>
                    {g.bookings} booking{g.bookings === 1 ? '' : 's'}, {nad(g.valueCents)} paid
                    {g.bookings ? `, average net ${nad(g.averageNetCents)}, lowest ${nad(g.minNetCents)}` : ''}
                    {g.negativeBookings ? `, ${g.negativeBookings} lost money` : ''}
                </p>
            </div>
        ))}
    </div>
);

const PLAN_LABEL = { basic: 'Basic', standard: 'Standard', none: 'No plan chosen' };
const COST_LABEL = { hosting: 'Hosting', maintenance: 'Maintenance', marketing: 'Marketing', staff: 'Staff', other: 'Other' };

export const DashboardView = ({ launch, onLocked, onOpenSettings }) => {
    const [period, setPeriod] = useState('month');
    const [d, setD] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setD(null);
        try {
            const range = PERIODS.find((p) => p[0] === period)[2]();
            setD((await financeService.dashboard(range)).data.data);
            setError('');
        } catch (err) {
            if (isLocked(err)) onLocked();
            else setError(apiError(err, 'Could not load the dashboard.'));
        }
    }, [period, onLocked]);
    useEffect(() => { load(); }, [load]);

    const gatesLeft = launch ? launch.items.filter((i) => !i.done).length : 0;
    return (
        <div style={list} data-testid="finance-dashboard">
            {launch && !launch.ready && (
                <div className="adm-note" data-testid="dash-launch">
                    <p style={{ margin: 0 }}>
                        Online payments are off: {gatesLeft} of {launch.items.length} launch item{launch.items.length === 1 ? '' : 's'} still to do.{' '}
                        <button type="button" className="adm-link" onClick={onOpenSettings}>See the checklist</button>
                    </p>
                </div>
            )}
            <div className="adm-seg" role="group" aria-label="Period" style={{ justifySelf: 'start' }}>
                {PERIODS.map(([k, label]) => (
                    <button key={k} type="button" aria-pressed={period === k} onClick={() => setPeriod(k)}>{label}</button>
                ))}
            </div>
            {error && <p role="alert" style={{ ...muted, color: red }}>{error}</p>}
            {!d && !error && <p style={muted}>Loading…</p>}
            {d && (
                <>
                    <p style={{ ...muted, fontSize: '0.76rem' }}>{d.period.from} to {d.period.to}</p>
                    <Kpis items={[
                        { testid: 'dash-revenue', label: 'Revenue', value: nad(d.revenue.totalCents), sub: 'Commission and fees kept' },
                        { testid: 'dash-net', label: 'Net contribution', value: nad(d.results.netContributionCents), tone: d.results.netContributionCents < 0 ? 'bad' : undefined, sub: 'After processing, booking costs and chargebacks' },
                        { testid: 'dash-bookings', label: 'Paid online', value: String(d.bookings.paidOnline), sub: d.bookings.paidOnline ? `${nad(d.bookings.valueCents)}, average ${nad(d.bookings.averageValueCents)}` : 'No bookings paid online' },
                        { testid: 'dash-breakeven', label: 'Break-even', value: d.results.breakEven.coveredPct === null ? 'No costs entered' : `${d.results.breakEven.coveredPct}%`,
                            sub: d.results.breakEven.fixedCostsCents
                                ? `of ${nad(d.results.breakEven.fixedCostsCents)} running costs${d.results.breakEven.moreBookingsNeeded ? `; about ${d.results.breakEven.moreBookingsNeeded} more bookings at the average net` : ''}`
                                : 'Enter the running costs under Costs' },
                    ]} />
                    <div className="adm-cols">
                    <div style={card} data-testid="dash-businesses">
                        <h3 style={h3}>Businesses</h3>
                        <Line k="Approved for online payments" v={d.businesses.approved} />
                        <Line k="Taking payments now" v={d.businesses.takingPayments} />
                        <Line k="Basic plan" v={d.businesses.byPlan.basic} />
                        <Line k="In the free trial" v={d.businesses.basicInTrial} />
                        <Line k="On the introductory price" v={d.businesses.basicIntroPrice} />
                        <Line k="Standard plan" v={d.businesses.byPlan.standard} />
                        {d.businesses.byPlan.none > 0 && <Line k="No plan chosen" v={d.businesses.byPlan.none} />}
                    </div>

                    <div style={card} data-testid="dash-revenue-detail">
                        <h3 style={h3}>Revenue</h3>
                        <Line k="Commission and fees, Basic" v={nad(d.revenue.byPlan.basic)} />
                        <Line k="Commission and fees, Standard" v={nad(d.revenue.byPlan.standard)} />
                        {d.revenue.byPlan.none > 0 && <Line k="Commission, no plan" v={nad(d.revenue.byPlan.none)} />}
                        {d.revenue.vatRegistered && <Line k="Of which VAT" v={nad(d.revenue.commissionCents - d.revenue.commissionExVatCents)} />}
                        <Line k="Subscriptions" v="Not billed yet" />
                    </div>

                    <div style={card} data-testid="dash-costs">
                        <h3 style={h3}>Costs</h3>
                        <Line k="Card processing (PayGate)" v={nad(d.costs.processingCostCents)} />
                        <Line k="Of which businesses paid" v={nad(d.costs.processingRecoveredCents)} />
                        <Line k={`Bookplus's cost per booking (${nad(d.costs.opsCostPerBookingCents)})`} v={nad(d.costs.opsCostCents)} />
                        <Line k={`Chargebacks lost (${d.costs.chargebacksLost})`} v={nad(d.costs.chargebackLossCents)} color={d.costs.chargebackLossCents ? red : undefined} />
                        <Line k="Recovered from businesses" v={nad(d.costs.chargebackRecoveredCents)} />
                        <Line k={`Refunds to clients (${d.costs.refunds})`} v={nad(d.costs.refundsToClientsCents)} />
                        <p style={{ ...muted, fontSize: '0.74rem', margin: '0.2rem 0 0.4rem' }}>Refunds come off the businesses' balances; Bookplus hands back its commission on them.</p>
                        {Object.entries(d.costs.fixedCostsByCategory).map(([k, v]) => <Line key={k} k={`Running costs: ${COST_LABEL[k] || k}`} v={nad(v)} />)}
                        {!d.costs.fixedCostMonthsEntered.length && <p style={muted}>No running costs entered for {d.period.months.join(', ')}.</p>}
                    </div>

                    <div style={card} data-testid="dash-per-booking">
                        <h3 style={h3}>Per booking</h3>
                        <Line k="Average net" v={d.results.perBooking.averageNetCents === null ? 'None yet' : nad(d.results.perBooking.averageNetCents)} />
                        <Line k="Lowest net" v={d.results.perBooking.minNetCents === null ? 'None yet' : nad(d.results.perBooking.minNetCents)} color={d.results.perBooking.minNetCents < 0 ? red : undefined} />
                        <Line k="Bookings that lost money" v={d.results.perBooking.negativeBookings} color={d.results.perBooking.negativeBookings ? red : undefined} />
                        <Line k="After running costs" v={nad(d.results.afterFixedCostsCents)} color={d.results.afterFixedCostsCents < 0 ? red : undefined} />
                    </div>

                    <div style={card} data-testid="dash-bands">
                        <h3 style={h3}>By booking value</h3>
                        <GroupRows rows={d.results.byBand} label={(g) => g.label} />
                    </div>

                    <div style={card} data-testid="dash-plans">
                        <h3 style={h3}>By plan</h3>
                        <GroupRows rows={Object.entries(d.results.byPlan).filter(([k, g]) => k !== 'none' || g.bookings).map(([k, g]) => ({ ...g, key: k }))} label={(g) => PLAN_LABEL[g.key]} />
                    </div>

                    <div style={card} data-testid="dash-top-businesses">
                        <h3 style={h3}>Businesses by net contribution</h3>
                        {d.results.businesses.count === 0 && <p style={muted}>None in this period.</p>}
                        {d.results.businesses.negative > 0 && <p style={{ ...muted, color: red, marginBottom: '0.4rem' }}>{d.results.businesses.negative} business{d.results.businesses.negative === 1 ? '' : 'es'} cost Bookplus money.</p>}
                        <GroupRows rows={d.results.businesses.rows.map((r) => ({ ...r, key: r.providerId }))} label={(g) => g.businessName || 'Business'} />
                    </div>
                    </div>
                </>
            )}
        </div>
    );
};

const thisMonth = () => ymd(new Date()).slice(0, 7);

export const CostsView = ({ isDirector, onLocked }) => {
    const toast = useToast();
    const [month, setMonth] = useState(thisMonth());
    const [data, setData] = useState(null);
    const [items, setItems] = useState([]);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setData(null);
        try {
            const r = (await financeService.getCosts(month)).data.data;
            setData(r);
            setItems(r.items.map((i) => ({ ...i, amount: (i.amountCents / 100).toFixed(2) })));
        } catch (err) {
            if (isLocked(err)) onLocked();
            else toast(apiError(err, 'Could not load the costs.'), 'error');
        }
    }, [month, onLocked, toast]);
    useEffect(() => { if (/^\d{4}-\d{2}$/.test(month)) load(); }, [load, month]);

    const set = (i, patch) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    const save = async () => {
        const out = [];
        for (const i of items) {
            const cents = parseCents(i.amount);
            if (cents === null) { toast(`Enter the amount for ${COST_LABEL[i.category]}, like 1500.00`, 'error'); return; }
            out.push({ category: i.category, label: (i.label || '').trim(), amountCents: cents });
        }
        setBusy(true);
        try {
            await financeService.putCosts(month, out, reason.trim());
            toast('Saved', 'success');
            setReason('');
            await load();
        } catch (err) {
            if (isLocked(err)) onLocked();
            else toast(apiError(err, 'Could not save.'), 'error');
        }
        setBusy(false);
    };

    const total = items.reduce((s, i) => s + (parseCents(i.amount) || 0), 0);
    return (
        <div style={list} data-testid="finance-costs">
            <p style={muted}>Bookplus's own running costs for each month. The dashboard sets them against what online payments earn, to show break-even. {isDirector ? '' : 'Only a director can change them.'}</p>
            <div style={{ maxWidth: '12rem' }}>
                <label htmlFor="costs-month" style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Month</label>
                <input id="costs-month" type="month" style={input} value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            {!data ? <p style={muted}>Loading…</p> : (
                <div style={card}>
                    {items.length === 0 && <p style={muted}>No costs entered for this month.</p>}
                    {items.map((i, n) => (
                        <div key={n} style={{ display: 'grid', gap: '0.4rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 8rem), 1fr))', alignItems: 'end', borderTop: n ? '1px solid var(--border)' : 'none', padding: '0.5rem 0' }} data-testid="cost-row">
                            <select aria-label="Category" style={input} disabled={!isDirector} value={i.category} onChange={(e) => set(n, { category: e.target.value })}>
                                {data.categories.map((c) => <option key={c} value={c}>{COST_LABEL[c] || c}</option>)}
                            </select>
                            <input aria-label="What it is" placeholder="What it is" style={input} disabled={!isDirector} value={i.label || ''} onChange={(e) => set(n, { label: e.target.value })} />
                            <input aria-label="Amount (N$)" inputMode="decimal" style={input} disabled={!isDirector} value={i.amount} onChange={(e) => set(n, { amount: e.target.value })} />
                            {isDirector && <button type="button" className="btn-outline" style={small} onClick={() => setItems((xs) => xs.filter((_, j) => j !== n))}>Remove</button>}
                        </div>
                    ))}
                    <div style={{ ...row, borderTop: '1px solid var(--border)', marginTop: '0.25rem' }}>
                        <span style={{ fontWeight: 600 }}>Total</span>
                        <span style={{ fontWeight: 600 }} data-testid="costs-total">{nad(total)}</span>
                    </div>
                    {isDirector && (
                        <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
                            <button type="button" className="btn-outline" style={{ ...small, justifySelf: 'start' }} onClick={() => setItems((xs) => [...xs, { category: 'hosting', label: '', amount: '' }])}>Add a cost</button>
                            <input aria-label="Why (for the audit log)" placeholder="Why (for the audit log)" style={input} value={reason} onChange={(e) => setReason(e.target.value)} />
                            <button type="button" className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save the costs'}</button>
                        </div>
                    )}
                    {data.updatedBy && <p style={{ ...muted, fontSize: '0.74rem', marginTop: '0.4rem' }}>Last changed by {data.updatedBy}.</p>}
                </div>
            )}
        </div>
    );
};

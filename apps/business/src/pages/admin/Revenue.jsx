import React, { useEffect, useRef, useState } from 'react';
import { useModalChrome, trapTab } from '../../hooks/useModalChrome';
import { FEATURES } from '@bookplus/config/features.mjs';
import { analyticsService } from '../../services';
import { PageHead, Panel, Kpis, Status, Empty } from '../../components/admin/ui';
import { BOOKING_STATUS, count, money0 } from './format';

// What each business has earned from completed bookings (what clients paid
// the business, not Bookplus's money: that is under Money), and its account
// balance with Bookplus. A business opens to its full breakdown.

const MEMBERSHIPS = FEATURES.membershipsEnabled;

const Detail = ({ id, onClose }) => {
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    // Escape, scroll lock and focus on open (once); Tab stays in the dialog.
    const box = useModalChrome(onClose);
    // Focus goes back to the business's name when it closes.
    const opener = useRef(typeof document !== 'undefined' ? document.activeElement : null);
    useEffect(() => () => { opener.current?.focus?.(); }, []);
    useEffect(() => {
        let alive = true;
        analyticsService.getProviderRevenueDetail(id)
            .then((r) => alive && setD(r.data.data))
            .catch(() => alive && setError('Could not load this business’s revenue.'));
        return () => { alive = false; };
    }, [id]);

    const max = d ? Math.max(...d.monthly.map((m) => m.revenue), 1) : 1;
    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,5,0.5)', zIndex: 1300, overflowY: 'auto', padding: '24px 16px' }}>
            <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={d ? `${d.provider.name}: revenue` : 'Revenue'} onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => trapTab(e, box.current)}
                className="adm-panel" style={{ maxWidth: 760, margin: '0 auto', outline: 'none' }}>
                <div className="adm-panel-head">
                    <div style={{ minWidth: 0 }}>
                        <h2>{d ? d.provider.name : 'Revenue'}</h2>
                        {d && (
                            <span className="adm-sub">
                                {d.provider.category || 'Business'} · {d.provider.email}
                                {d.provider.joinedAt ? ` · on Bookplus since ${new Date(d.provider.joinedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` : ''}
                                {d.provider.isActive ? '' : ' · suspended'}
                            </span>
                        )}
                    </div>
                    <button type="button" className="btn-outline" onClick={onClose}>Close</button>
                </div>
                {error ? <div className="adm-panel-body"><div role="alert" className="adm-error">{error}</div></div> : !d ? <Empty>Loading…</Empty> : (
                    <div className="adm-panel-body" style={{ display: 'grid', gap: 18 }}>
                        <Kpis items={[
                            { label: 'Total revenue', value: money0(d.revenue.total) },
                            { label: 'This month', value: money0(d.revenue.thisMonth), sub: d.revenue.growthPct === undefined ? null : <span className={d.revenue.growthPct >= 0 ? 'adm-up' : 'adm-down'}>{d.revenue.growthPct >= 0 ? '+' : '−'}{Math.abs(d.revenue.growthPct)}% on last month</span> },
                            { label: 'Average booking', value: money0(d.revenue.avgTicket) },
                            { label: 'Account balance', value: money0(d.walletBalance) },
                        ]} />
                        <div>
                            <div className="adm-label">Revenue from bookings, last 6 months</div>
                            <div className="adm-bars" style={{ height: 120 }}>
                                {d.monthly.map((m) => (
                                    <div key={m.label} title={`${m.label}: ${money0(m.revenue)}`}><span style={{ height: `${(m.revenue / max) * 100}%` }} /></div>
                                ))}
                            </div>
                            <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
                                {d.monthly.map((m) => <span key={m.label} className="adm-muted" style={{ flex: 1, textAlign: 'center', fontSize: '0.72rem' }}>{m.label}</span>)}
                            </div>
                        </div>
                        <div className="adm-cols">
                            <div>
                                <div className="adm-label">Top services</div>
                                {d.topServices.length === 0 ? <p className="adm-muted">No completed bookings yet.</p> : (
                                    <table className="adm-table"><tbody>
                                        {d.topServices.map((s, i) => (
                                            <tr key={String(s._id ?? i)}><td style={{ paddingLeft: 0 }}>{s.name}<span className="adm-sub">{count(s.count)} booking{s.count === 1 ? '' : 's'}</span></td><td className="num" style={{ paddingRight: 0 }}>{money0(s.revenue)}</td></tr>
                                        ))}
                                    </tbody></table>
                                )}
                            </div>
                            <div>
                                <div className="adm-label">Bookings</div>
                                <table className="adm-table"><tbody>
                                    {['completed', 'confirmed', 'pending', 'cancelled', 'no-show'].filter((s) => d.appointments.byStatus[s]).map((s) => (
                                        <tr key={s}><td style={{ paddingLeft: 0 }}><Status tone={BOOKING_STATUS[s][1]}>{BOOKING_STATUS[s][0]}</Status></td><td className="num" style={{ paddingRight: 0 }}>{count(d.appointments.byStatus[s])}</td></tr>
                                    ))}
                                    <tr><td style={{ paddingLeft: 0 }}>Clients served</td><td className="num" style={{ paddingRight: 0 }}>{count(d.appointments.uniqueClients)}</td></tr>
                                    {MEMBERSHIPS && <tr><td style={{ paddingLeft: 0 }}>Active packages</td><td className="num" style={{ paddingRight: 0 }}>{d.packages.active} of {d.packages.count}</td></tr>}
                                </tbody></table>
                            </div>
                        </div>
                        <div>
                            <div className="adm-label">Latest completed bookings</div>
                            {d.recent.length === 0 ? <p className="adm-muted">None yet.</p> : (
                                <table className="adm-table"><tbody>
                                    {d.recent.map((r) => (
                                        <tr key={r._id}>
                                            <td style={{ paddingLeft: 0 }}>{r.client} · {r.service}</td>
                                            <td className="nowrap dim">{new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                                            <td className="num" style={{ paddingRight: 0 }}>{money0(r.amount)}</td>
                                        </tr>
                                    ))}
                                </tbody></table>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const Revenue = () => {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [open, setOpen] = useState(null);
    const load = () => {
        setError('');
        analyticsService.getProviderRevenueList().then((r) => setData(r.data.data)).catch(() => setError('Could not load revenue.'));
    };
    useEffect(load, []);

    return (
        <>
            <PageHead title="Revenue" />
            <div className="adm-stack">
                <p className="adm-muted">What businesses earned from completed bookings. Bookplus’s own commission and fees are under Money.</p>
                {error ? (
                    <div role="alert" className="adm-error">{error} <button type="button" className="adm-link" onClick={load}>Try again</button></div>
                ) : !data ? <Panel><Empty>Loading…</Empty></Panel> : (
                    <>
                        <Kpis items={[
                            { label: 'Total revenue', value: money0(data.platform.totalRevenue), sub: MEMBERSHIPS ? 'Bookings and packages, all time' : 'All time' },
                            { label: 'This month', value: money0(data.platform.thisMonthRevenue), sub: 'From bookings' },
                            { label: 'Completed bookings', value: count(data.platform.completedCount), sub: money0(data.platform.servicesRevenue) },
                            ...(MEMBERSHIPS ? [{ label: 'Packages', value: money0(data.platform.packageRevenue) }] : []),
                        ]} />
                        <Panel title="By business">
                            {data.providers.length === 0 ? <Empty>No businesses yet.</Empty> : (
                                <div className="adm-scroll">
                                    <table className="adm-table wide">
                                        <thead><tr><th>Business</th><th className="num">Completed</th><th className="num">From bookings</th>{MEMBERSHIPS && <th className="num">Packages</th>}<th className="num">Total</th><th className="num">Account balance</th></tr></thead>
                                        <tbody>
                                            {data.providers.map((p) => (
                                                <tr key={p._id}>
                                                    <td>
                                                        <button type="button" className="adm-link" onClick={() => setOpen(p._id)}>{p.name}</button>
                                                        <span className="adm-sub">{p.category || p.email}{p.isActive ? '' : ' · suspended'}</span>
                                                    </td>
                                                    <td className="num">{count(p.completedCount)}</td>
                                                    <td className="num">{money0(p.servicesRevenue)}</td>
                                                    {MEMBERSHIPS && <td className="num">{p.packageCount > 0 ? money0(p.packageRevenue) : '—'}</td>}
                                                    <td className="num strong">{money0(p.totalRevenue)}</td>
                                                    <td className="num">{money0(p.walletBalance)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </Panel>
                    </>
                )}
            </div>
            {open && <Detail id={open} onClose={() => setOpen(null)} />}
        </>
    );
};

export default Revenue;

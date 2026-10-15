import React, { useCallback, useEffect, useState } from 'react';
import { analyticsService } from '../../services';
import { PageHead, Panel, Kpis, Seg, Status, Empty } from '../../components/admin/ui';
import { BOOKING_STATUS, count } from './format';

// The platform over time: people, bookings, the last 30 days, what is booked
// most, the busiest days and how services are rated. "Users" means clients and
// business owners everywhere in the console.

const Bars = ({ data }) => {
    const max = Math.max(...data.map((d) => d.count), 1);
    return (
        <>
            <div className="adm-bars">
                {data.map((d) => (
                    <div key={d.label} title={`${d.label}: ${d.count}`}><span style={{ height: `${d.count ? Math.max((d.count / max) * 100, 2) : 0}%` }} /></div>
                ))}
            </div>
            <div className="adm-bar" style={{ marginTop: 6 }}>
                <span className="adm-muted">{data[0]?.label}</span>
                <span className="adm-muted">{data[data.length - 1]?.label}</span>
            </div>
        </>
    );
};

const Insights = () => {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [series, setSeries] = useState('bookings');

    const load = useCallback(async () => {
        setBusy(true);
        try { setData((await analyticsService.getAnalytics()).data.data); setError(''); } catch { setError('Could not load insights.'); }
        setBusy(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const head = <PageHead title="Insights"><button type="button" className="btn-outline" onClick={load} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button></PageHead>;
    if (error) return <>{head}<div role="alert" className="adm-error">{error}</div></>;
    if (!data) return <>{head}<Panel><Empty>Loading…</Empty></Panel></>;

    const { appointments, bookingsOverTime, users, newUsersOverTime, popularServices, busiestDays, ratingsPerService } = data;
    const byStatus = Object.fromEntries(appointments.byStatus.map((s) => [s._id, s.count]));
    const statusTotal = appointments.byStatus.reduce((s, x) => s + x.count, 0) || 1;
    const busiest = busiestDays[0]?.count || 1;
    return (
        <>
            {head}
            <div className="adm-stack">
                <div style={{ display: 'grid', gap: 8 }}>
                    <Kpis items={[
                        { label: 'Users', value: count(users.total), sub: `${count(users.customers)} client${users.customers === 1 ? '' : 's'} · ${count(users.providers)} business owner${users.providers === 1 ? '' : 's'}` },
                        { label: 'New this month', value: count(users.newThisMonth) },
                        { label: 'New in the last 7 days', value: count(users.newLastWeek) },
                        { label: 'Team members', value: count(users.teamLogins ?? 0), sub: `at ${count(users.teamBusinesses ?? 0)} business${users.teamBusinesses === 1 ? '' : 'es'}` },
                    ]} />
                    <p className="adm-muted">Users are clients and business owners. Team members and admins are counted separately.</p>
                </div>
                <Kpis items={[
                    { label: 'Bookings', value: count(appointments.total), sub: `${count(appointments.pending ?? 0)} pending · ${count(appointments.thisMonth)} this month` },
                    { label: 'Completed', value: count(byStatus.completed || 0) },
                    { label: 'Cancelled', value: count(byStatus.cancelled || 0) },
                    { label: 'Completion rate', value: `${appointments.total ? Math.round(((byStatus.completed || 0) / appointments.total) * 100) : 0}%`, sub: 'Of all bookings' },
                ]} />

                <Panel title="Last 30 days" aside={<Seg label="Show" options={[['bookings', 'Bookings'], ['users', 'New users']]} value={series} onChange={setSeries} />} body>
                    <Bars data={series === 'bookings' ? bookingsOverTime : newUsersOverTime} />
                </Panel>

                <div className="adm-cols">
                    <Panel title="Bookings by status">
                        <table className="adm-table"><tbody>
                            {['completed', 'confirmed', 'pending', 'cancelled', 'no-show'].map((s) => (
                                <tr key={s}>
                                    <td><Status tone={BOOKING_STATUS[s][1]}>{BOOKING_STATUS[s][0]}</Status></td>
                                    <td style={{ width: '40%' }}><div className="adm-meter" style={{ marginTop: 6 }}><span style={{ width: `${((byStatus[s] || 0) / statusTotal) * 100}%` }} /></div></td>
                                    <td className="num">{count(byStatus[s] || 0)}</td>
                                </tr>
                            ))}
                        </tbody></table>
                    </Panel>
                    <Panel title="Busiest days">
                        {busiestDays.length === 0 ? <Empty>No bookings yet.</Empty> : (
                            <table className="adm-table"><tbody>
                                {busiestDays.map((d) => (
                                    <tr key={d.day}>
                                        <td style={{ width: '3.5rem' }}>{d.day}</td>
                                        <td><div className="adm-meter" style={{ marginTop: 6 }}><span style={{ width: `${(d.count / busiest) * 100}%` }} /></div></td>
                                        <td className="num">{count(d.count)}</td>
                                    </tr>
                                ))}
                            </tbody></table>
                        )}
                    </Panel>
                </div>

                <div className="adm-cols">
                    <Panel title="Most booked services">
                        {popularServices.length === 0 ? <Empty>No bookings yet.</Empty> : (
                            <table className="adm-table">
                                <thead><tr><th>Service</th><th className="num">Bookings</th></tr></thead>
                                <tbody>{popularServices.map((s, i) => <tr key={String(s._id ?? i)}><td>{s.name}</td><td className="num">{count(s.count)}</td></tr>)}</tbody>
                            </table>
                        )}
                    </Panel>
                    <Panel title="Service ratings">
                        {ratingsPerService.length === 0 ? <Empty>No reviews yet.</Empty> : (
                            <table className="adm-table">
                                <thead><tr><th>Service</th><th className="num">Reviews</th><th className="num">Average</th></tr></thead>
                                <tbody>{ratingsPerService.map((s, i) => <tr key={String(s._id ?? i)}><td>{s.name}</td><td className="num">{count(s.count)}</td><td className="num">{Number(s.avgRating).toFixed(1)} / 5</td></tr>)}</tbody>
                            </table>
                        )}
                    </Panel>
                </div>
            </div>
        </>
    );
};

export default Insights;

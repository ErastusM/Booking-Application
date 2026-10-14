import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FEATURES } from '@bookplus/config/features.mjs';
import { analyticsService, appointmentService } from '../../services';
import { appointmentBusiness, appointmentClient } from '../../utils/adminPanel';
import { PageHead, Panel, Kpis, Status, Empty } from '../../components/admin/ui';
import { useAdminData } from './adminData';
import { BOOKING_STATUS, bookingDay, cents, count, day, money, money0, plural } from './format';

// What needs someone first, the platform in four figures, and the latest bookings.

const NeedsYou = ({ counts }) => {
    if (!counts) return <Empty>Loading…</Empty>;
    const rows = [];
    if (counts.applications) rows.push({
        tone: 'bad', to: 'money/approvals', action: 'Review',
        text: `${plural(counts.applications, 'business', 'businesses')} waiting for online payments approval`,
        sub: counts.oldestApplication ? `Oldest sent ${day(counts.oldestApplication)}` : null,
    });
    if (counts.requests) rows.push({
        tone: 'bad', to: 'money/approvals', action: 'Review',
        text: `${plural(counts.requests, 'refund or adjustment', 'refunds or adjustments')} waiting for a director`,
    });
    if (counts.payments) rows.push({
        tone: 'warn', to: 'money/payments', action: 'Open',
        text: `${plural(counts.payments, 'payment')} to look at`, sub: 'Open too long, flagged, or a refund on its way',
    });
    if (counts.payouts) rows.push({
        tone: 'warn', to: 'money/payouts', action: 'Prepare',
        text: `${plural(counts.payouts, 'payout')} due`,
        sub: `${cents(counts.payoutsCents)}${counts.payoutSchedule?.nextRunDate ? ` · next run ${day(counts.payoutSchedule.nextRunDate)}` : ''}`,
    });
    if (counts.cases) rows.push({ tone: 'warn', to: 'money/disputes', action: 'Open', text: `${plural(counts.cases, 'open case')}` });
    if (counts.topUps) rows.push({ tone: 'warn', to: 'wallets', action: 'Review', text: `${plural(counts.topUps, 'wallet top-up')} to approve` });
    const launch = counts.launch;
    if (launch && !launch.ready) {
        const done = launch.items.filter((i) => i.done).length;
        rows.push({ to: 'settings/go-live', action: 'Continue', text: `Go-live checklist: ${done} of ${launch.items.length} done`, sub: 'Online payments stay off until it is complete' });
    }
    if (!rows.length) return <Empty>Nothing needs you right now.</Empty>;
    return rows.map((r) => (
        <div className="adm-row" key={r.text} data-testid="needs-you-row">
            <div><Status tone={r.tone}>{r.text}</Status>{r.sub && <span className="adm-sub" style={{ marginLeft: 14 }}>{r.sub}</span>}</div>
            <Link className="adm-link" to={`/bkplus-command/${r.to}`}>{r.action}</Link>
        </div>
    ));
};

const Overview = () => {
    const { counts } = useAdminData();
    const [overview, setOverview] = useState(null);
    const [latest, setLatest] = useState(null);

    useEffect(() => {
        analyticsService.getAdminOverview().then((r) => setOverview(r.data.data)).catch(() => setOverview(false));
        appointmentService.getAllAppointments({ page: 1 }).then((r) => setLatest((r.data.data || []).slice(0, 6))).catch(() => setLatest([]));
    }, []);

    const show = (v) => (overview ? v : '—');
    return (
        <>
            <PageHead title="Overview" />
            <div className="adm-stack">
                <Kpis items={[
                    { label: 'Bookings', value: show(count(overview?.appointments)), sub: overview ? `${count(overview.pending)} waiting to be confirmed` : null },
                    { label: 'Users', value: show(count(overview?.users)), sub: 'Clients and business owners' },
                    { label: 'Active services', value: show(count(overview?.activeServices)), sub: 'Bookable now' },
                    { label: 'Revenue', value: overview ? money0(overview.revenue) : '—', sub: FEATURES.membershipsEnabled ? 'Completed bookings and packages, all time' : 'Completed bookings, all time' },
                ]} data-testid="overview-figures" />
                <div className="adm-cols adm-cols-wide">
                    <Panel title="Needs you" data-testid="needs-you">
                        <NeedsYou counts={counts} />
                    </Panel>
                    <Panel title="Latest bookings" aside={<Link className="adm-link" to="/bkplus-command/bookings">All bookings</Link>}>
                        {!latest ? <Empty>Loading…</Empty> : !latest.length ? <Empty>No bookings yet.</Empty> : (
                            <div className="adm-scroll">
                                <table className="adm-table">
                                    <thead><tr><th>Business</th><th>When</th><th className="num">Price</th></tr></thead>
                                    <tbody>
                                        {latest.map((a) => {
                                            const [label, tone] = BOOKING_STATUS[a.status] || BOOKING_STATUS.pending;
                                            const client = appointmentClient(a);
                                            return (
                                                <tr key={a._id}>
                                                    <td>
                                                        <span className="strong">{appointmentBusiness(a).name}</span>
                                                        <span className="adm-sub">{a.service?.name}{client.name ? ` · ${client.name}` : ''}</span>
                                                    </td>
                                                    <td className="nowrap">
                                                        <Status tone={tone}>{a.status === 'cancelled' || a.status === 'no-show' ? label : `${bookingDay(a.appointmentDate)} ${a.startTime || ''}`}</Status>
                                                    </td>
                                                    <td className={`num ${a.status === 'cancelled' ? 'dim' : ''}`}>{money(a.totalPrice)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Panel>
                </div>
            </div>
        </>
    );
};

export default Overview;

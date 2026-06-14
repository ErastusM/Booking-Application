import React, { useEffect, useState } from 'react';
import { analyticsService } from '../services';

// ── Tiny chart components ──────────────────────────────────────────

const BarChart = ({ data, valueKey, labelKey, color = 'var(--gold)', height = 160 }) => {
    const max = Math.max(...data.map(d => d[valueKey]), 1);
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height, paddingTop: '1rem' }}>
            {data.map((d, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end' }}>
                    <div
                        title={`${d[labelKey]}: ${d[valueKey]}`}
                        style={{
                            width: '100%', borderRadius: '3px 3px 0 0',
                            background: color, opacity: 0.85,
                            height: `${Math.max((d[valueKey] / max) * 100, d[valueKey] > 0 ? 4 : 0)}%`,
                            transition: 'height 0.5s ease',
                            minHeight: d[valueKey] > 0 ? '4px' : '0',
                            cursor: 'default',
                        }}
                    />
                </div>
            ))}
        </div>
    );
};

const DonutChart = ({ data }) => {
    const colors = { pending: '#fbbf24', confirmed: '#60a5fa', completed: '#34d399', cancelled: '#f87171' };
    const labels = { pending: 'Pending', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };
    const total = data.reduce((s, d) => s + d.count, 0) || 1;

    let cumulative = 0;
    const slices = data.map(d => {
        const pct = d.count / total;
        const start = cumulative;
        cumulative += pct;
        return { ...d, pct, start };
    });

    const polarToCartesian = (pct) => {
        const angle = pct * 2 * Math.PI - Math.PI / 2;
        return { x: 50 + 35 * Math.cos(angle), y: 50 + 35 * Math.sin(angle) };
    };

    const describeArc = (start, end) => {
        if (end - start >= 1) return `M 50 50 m -35 0 a 35 35 0 1 1 70 0 a 35 35 0 1 1 -70 0`;
        const s = polarToCartesian(start);
        const e = polarToCartesian(end);
        const large = end - start > 0.5 ? 1 : 0;
        return `M 50 50 L ${s.x} ${s.y} A 35 35 0 ${large} 1 ${e.x} ${e.y} Z`;
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
            <svg viewBox="0 0 100 100" width="120" height="120" style={{ flexShrink: 0 }}>
                {slices.map((s, i) => (
                    <path key={i} d={describeArc(s.start, s.start + s.pct)} fill={colors[s._id] || '#ccc'} />
                ))}
                <circle cx="50" cy="50" r="22" fill="white" />
                <text x="50" y="54" textAnchor="middle" fontSize="12" fontWeight="bold" fill="var(--charcoal)">{total}</text>
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {slices.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: colors[s._id] || '#ccc', flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-secondary)' }}>{labels[s._id] || s._id}</span>
                        <span style={{ fontWeight: '600', color: 'var(--charcoal)', marginLeft: 'auto' }}>{s.count}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const MiniStat = ({ label, value, sub, icon, trend }) => (
    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>{label}</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.8rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1 }}>{value}</p>
                {sub && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>{sub}</p>}
            </div>
            <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(201,168,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>
                {icon}
            </div>
        </div>
        {trend !== undefined && (
            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: '600', color: trend >= 0 ? '#065f46' : '#991b1b', background: trend >= 0 ? '#d1fae5' : '#fee2e2', padding: '0.15rem 0.5rem', borderRadius: '99px' }}>
                    {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last month
                </span>
            </div>
        )}
    </div>
);

const Card = ({ title, children, style }) => (
    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', ...style }}>
        {title && (
            <h3 style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>
                {title}
            </h3>
        )}
        {children}
    </div>
);

const StarRating = ({ rating }) => (
    <div style={{ display: 'flex', gap: '2px' }}>
        {[1, 2, 3, 4, 5].map(s => (
            <span key={s} style={{ color: s <= Math.round(rating) ? 'var(--gold)' : '#e2e0db', fontSize: '0.85rem' }}>★</span>
        ))}
    </div>
);

// ── Main Component ─────────────────────────────────────────────────

const AnalyticsDashboard = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [chartMode, setChartMode] = useState('bookings'); // bookings | users

    useEffect(() => { fetchAnalytics(); }, []);

    const fetchAnalytics = async () => {
        try {
            const res = await analyticsService.getAnalytics();
            setData(res.data.data);
        } catch {
            setError('Failed to load analytics');
        } finally {
            setLoading(false);
        }
    };

    if (loading) return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading analytics...</p>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );

    if (error) return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: '#991b1b' }}>{error}</p>
        </div>
    );

    const { appointments, bookingsOverTime, users, newUsersOverTime, popularServices, busiestDays, ratingsPerService } = data;

    const chartData = chartMode === 'bookings' ? bookingsOverTime : newUsersOverTime;

    const chartValueKey = 'count';
    const chartColor = chartMode === 'users' ? '#60a5fa' : 'var(--gold)';
    const completedCount = appointments.byStatus.find(s => s._id === 'completed')?.count || 0;
    const cancelledCount = appointments.byStatus.find(s => s._id === 'cancelled')?.count || 0;

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100vh' }}>

            {/* Header */}
            <div style={{ background: 'var(--ink)', paddingTop: '9rem', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 80% 30%, rgba(201,168,76,0.05) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                        <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Insights</p>
                        <h1 style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: '700', color: 'white' }}>Analytics</h1>
                    </div>
                    <button onClick={fetchAnalytics} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', padding: '0.5rem 1.25rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'var(--font-body)' }}>
                        ↻ Refresh
                    </button>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '2.5rem', paddingBottom: '5rem' }}>

                {/* ── Booking KPIs ── */}
                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                    <MiniStat label="Total Bookings" value={appointments.total} icon="📋" sub={`${appointments.thisMonth} this month`} />
                    <MiniStat label="Completed" value={completedCount} icon="✅" sub="All time" />
                    <MiniStat label="Cancelled" value={cancelledCount} icon="🚫" sub="All time" />
                    <MiniStat label="Total Users" value={users.total} icon="👥" sub={`${users.newThisMonth} new this month`} />
                </div>

                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                    <MiniStat label="Customers" value={users.customers} icon="🧑" />
                    <MiniStat label="Providers" value={users.providers} icon="💈" />
                    <MiniStat label="New This Week" value={users.newLastWeek} icon="🆕" sub="New users" />
                    <MiniStat label="Completion Rate" value={`${appointments.total ? Math.round((appointments.byStatus.find(s => s._id === 'completed')?.count || 0) / appointments.total * 100) : 0}%`} icon="✅" sub="Of all bookings" />
                </div>

                {/* ── Time series chart ── */}
                <Card title="" style={{ marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <h3 style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)' }}>
                            Last 30 Days
                        </h3>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            {[
                                { key: 'bookings', label: 'Bookings' },
                                { key: 'users', label: 'New Users' },
                            ].map(m => (
                                <button key={m.key} onClick={() => setChartMode(m.key)} style={{
                                    padding: '0.35rem 0.875rem', borderRadius: '99px', border: '1.5px solid',
                                    borderColor: chartMode === m.key ? 'var(--gold)' : 'var(--border)',
                                    background: chartMode === m.key ? 'rgba(201,168,76,0.1)' : 'transparent',
                                    color: chartMode === m.key ? 'var(--gold-dark)' : 'var(--text-muted)',
                                    fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer',
                                    fontFamily: 'var(--font-body)',
                                }}>
                                    {m.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <BarChart data={chartData} valueKey={chartValueKey} labelKey="label" color={chartColor} height={180} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{chartData[0]?.label}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{chartData[chartData.length - 1]?.label}</span>
                    </div>
                </Card>

                {/* ── Middle row ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>

                    {/* Appointment breakdown */}
                    <Card title="Appointment Breakdown">
                        <DonutChart data={appointments.byStatus} />
                    </Card>

                    {/* New users over the last 30 days */}
                    <Card title="New Users (30 Days)">
                        <BarChart data={newUsersOverTime} valueKey="count" labelKey="label" color="#60a5fa" height={160} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{newUsersOverTime[0]?.label}</span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{newUsersOverTime[newUsersOverTime.length - 1]?.label}</span>
                        </div>
                    </Card>
                </div>

                {/* ── Bottom row ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem' }}>

                    {/* Popular services */}
                    <Card title="Most Booked Services">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {popularServices.map((s, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: i === 0 ? 'var(--gold)' : 'var(--warm-gray)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: '700', color: i === 0 ? 'var(--charcoal)' : 'var(--text-muted)', flexShrink: 0 }}>
                                        {i + 1}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <p style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--charcoal)' }}>{s.name}</p>
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.count} booking{s.count !== 1 ? 's' : ''}</p>
                                    </div>
                                    <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--gold-dark)' }}>{s.count}×</span>
                                </div>
                            ))}
                            {popularServices.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No bookings yet</p>}
                        </div>
                    </Card>

                    {/* Busiest days */}
                    <Card title="Busiest Days">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            {busiestDays.length === 0 ? (
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No data yet</p>
                            ) : (
                                busiestDays.map((d, i) => {
                                    const max = busiestDays[0]?.count || 1;
                                    return (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', width: '32px', flexShrink: 0 }}>{d.day}</span>
                                            <div style={{ flex: 1, height: '8px', borderRadius: '99px', background: 'var(--warm-gray)', overflow: 'hidden' }}>
                                                <div style={{ height: '100%', borderRadius: '99px', background: i === 0 ? 'var(--gold)' : 'var(--charcoal)', opacity: i === 0 ? 1 : 0.3 + (0.6 * (1 - i / busiestDays.length)), width: `${(d.count / max) * 100}%`, transition: 'width 0.5s ease' }} />
                                            </div>
                                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', width: '20px', textAlign: 'right', flexShrink: 0 }}>{d.count}</span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </Card>

                    {/* Ratings per service */}
                    <Card title="Service Ratings">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {ratingsPerService.length === 0 ? (
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No reviews yet</p>
                            ) : (
                                ratingsPerService.map((s, i) => (
                                    <div key={i}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                            <span style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--charcoal)' }}>{s.name}</span>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.count} review{s.count !== 1 ? 's' : ''}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <StarRating rating={s.avgRating} />
                                            <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--charcoal)' }}>{s.avgRating}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default AnalyticsDashboard;
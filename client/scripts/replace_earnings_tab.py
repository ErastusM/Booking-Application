import io, os

path = os.path.join(os.path.dirname(__file__), '..', 'src', 'pages', 'ProviderDashboard.js')
path = os.path.abspath(path)
s = io.open(path, encoding='utf-8').read()

start_marker = "                {/* Earnings tab */}"
end_marker = "                {/* Calendar tab */}"
i = s.index(start_marker)
j = s.index(end_marker)

new_block = u"""                {/* Overview tab — non-financial business stats */}
                {activeTab === 'overview' && (() => {
                    const todayStr = new Date().toDateString();
                    const now = new Date();
                    const todays = appointments.filter(a => new Date(a.appointmentDate).toDateString() === todayStr && a.status !== 'cancelled');
                    const upcoming = appointments.filter(a => new Date(a.appointmentDate) >= now && a.status === 'confirmed');
                    const completedAll = appointments.filter(a => a.status === 'completed');
                    const cancelledAll = appointments.filter(a => a.status === 'cancelled');
                    const byService = Object.values(appointments.reduce((acc, a) => {
                        const name = a.service?.name || 'Other';
                        acc[name] = acc[name] || { name, count: 0 };
                        acc[name].count += 1;
                        return acc;
                    }, {})).sort((a, b) => b.count - a.count).slice(0, 6);
                    const recent = [...appointments].sort((a, b) => new Date(b.appointmentDate) - new Date(a.appointmentDate)).slice(0, 8);
                    const clientNames = new Set(appointments.map(a => a.customer?._id || a.walkInName).filter(Boolean));
                    return (
                        <div>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Business Overview</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Your bookings at a glance</p>
                            </div>

                            <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                                {[
                                    { label: "Today's Bookings", value: todays.length, icon: '\U0001f4c5', sub: 'Scheduled today' },
                                    { label: 'Upcoming', value: upcoming.length, icon: '⏳', sub: 'Confirmed ahead' },
                                    { label: 'Completed', value: completedAll.length, icon: '✅', sub: 'All time' },
                                    { label: 'Clients Served', value: clientNames.size, icon: '\U0001f465', sub: `${cancelledAll.length} cancellations` },
                                ].map((s, i) => (
                                    <div key={i} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(201,168,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>{s.icon}</div>
                                        <div>
                                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{s.label}</p>
                                            <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.5rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1 }}>{s.value}</p>
                                            {s.sub && <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{s.sub}</p>}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="provider-profile-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                    <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Popular Services</h3>
                                    {byService.length === 0 ? (
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No bookings yet</p>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                                            {byService.map((s, i) => {
                                                const max = byService[0]?.count || 1;
                                                return (
                                                    <div key={i}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                                                            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: '500' }}>{s.name}</span>
                                                            <span style={{ fontSize: '0.875rem', fontWeight: '700', color: 'var(--charcoal)' }}>{s.count} booking{s.count !== 1 ? 's' : ''}</span>
                                                        </div>
                                                        <div style={{ height: '6px', borderRadius: '99px', background: 'var(--warm-gray)', overflow: 'hidden' }}>
                                                            <div style={{ height: '100%', borderRadius: '99px', background: 'var(--gold)', width: `${(s.count / max) * 100}%`, transition: 'width 0.5s ease' }} />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                    <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Booking Status</h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {['pending', 'confirmed', 'completed', 'cancelled'].map(st => {
                                            const cnt = appointments.filter(a => a.status === st).length;
                                            const total = Math.max(appointments.length, 1);
                                            const cfg = statusConfig[st];
                                            return (
                                                <div key={st}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                                                        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: '500', textTransform: 'capitalize' }}>{cfg?.label || st}</span>
                                                        <span style={{ fontSize: '0.875rem', fontWeight: '700', color: 'var(--charcoal)' }}>{cnt}</span>
                                                    </div>
                                                    <div style={{ height: '8px', borderRadius: '99px', background: 'var(--warm-gray)', overflow: 'hidden' }}>
                                                        <div style={{ height: '100%', borderRadius: '99px', background: cfg?.bg || 'var(--gold)', width: `${(cnt / total) * 100}%`, transition: 'width 0.5s ease' }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                                    <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)' }}>Recent Activity</h3>
                                </div>
                                {recent.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}><p>No bookings yet</p></div>
                                ) : (
                                    <div className="table-scroll">
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                                            <thead>
                                                <tr style={{ background: 'var(--warm-gray)', borderBottom: '1px solid var(--border)' }}>
                                                    {['Client', 'Service', 'Date', 'Time', 'Status'].map(h => (
                                                        <th key={h} style={{ padding: '0.875rem 1rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{h}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {recent.map((a) => {
                                                    const cfg = statusConfig[a.status] || statusConfig.pending;
                                                    return (
                                                        <tr key={a._id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                            <td style={{ padding: '0.875rem 1rem', fontWeight: '600', color: 'var(--charcoal)' }}>{a.walkInName || a.customer?.name || '—'}</td>
                                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{a.service?.name}</td>
                                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{new Date(a.appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{a.startTime} – {a.endTime}</td>
                                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                                <span style={{ padding: '0.2rem 0.65rem', borderRadius: '99px', fontSize: '0.72rem', fontWeight: '600', background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()}

"""

s = s[:i] + new_block + s[j:]
io.open(path, 'w', encoding='utf-8', newline='').write(s)
print('Replaced earnings tab with overview tab')

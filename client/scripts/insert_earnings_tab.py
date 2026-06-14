# -*- coding: utf-8 -*-
import io, os

path = os.path.join(os.path.dirname(__file__), '..', 'src', 'pages', 'ProviderDashboard.js')
path = os.path.abspath(path)
s = io.open(path, encoding='utf-8').read()

anchor = "                })()}\n\n                {/* Calendar tab */}"
assert s.count(anchor) == 1, f"anchor count = {s.count(anchor)}"

block = r'''                })()}

                {/* Earnings tab — value of completed appointments (reporting only) */}
                {activeTab === 'earnings' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
                            <div>
                                <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Earnings</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Value of your completed appointments. Collected in person.</p>
                            </div>
                            <button onClick={exportEarningsCsv} disabled={!earnings} style={{ padding: '0.5rem 1rem', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: earnings ? 'pointer' : 'not-allowed', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', fontFamily: 'Outfit, sans-serif' }}>
                                ⬇ Export CSV
                            </button>
                        </div>

                        {/* Date range presets */}
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                            {[['week','This week'],['month','This month'],['lastMonth','Last month'],['30d','Last 30 days']].map(([key, label]) => (
                                <button key={key} onClick={() => { setEarningsPreset(key); fetchEarnings(key); }} style={{
                                    padding: '0.4rem 1rem', borderRadius: '99px', border: '1.5px solid',
                                    borderColor: earningsPreset === key ? 'var(--gold)' : 'var(--border)',
                                    background: earningsPreset === key ? 'rgba(201,168,76,0.12)' : 'var(--card-bg)',
                                    color: earningsPreset === key ? 'var(--gold-dark)' : 'var(--text-secondary)',
                                    fontSize: '0.8rem', fontWeight: earningsPreset === key ? '600' : '400', cursor: 'pointer', fontFamily: 'Outfit, sans-serif',
                                }}>{label}</button>
                            ))}
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginLeft: '0.25rem' }}>
                                <input type="date" value={earningsRange.from} onChange={e => setEarningsRange(r => ({ ...r, from: e.target.value }))} className="input" style={{ fontSize: '0.78rem', padding: '0.35rem 0.5rem' }} />
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>–</span>
                                <input type="date" value={earningsRange.to} onChange={e => setEarningsRange(r => ({ ...r, to: e.target.value }))} className="input" style={{ fontSize: '0.78rem', padding: '0.35rem 0.5rem' }} />
                                <button onClick={() => { setEarningsPreset('custom'); fetchEarnings('custom', earningsRange); }} disabled={!earningsRange.from || !earningsRange.to} style={{ padding: '0.4rem 0.85rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: '600', cursor: (earningsRange.from && earningsRange.to) ? 'pointer' : 'not-allowed', fontFamily: 'Outfit, sans-serif' }}>Apply</button>
                            </div>
                        </div>

                        {loadingEarnings ? (
                            <div style={{ textAlign: 'center', padding: '4rem' }}>
                                <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
                            </div>
                        ) : earningsError ? (
                            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                                <p style={{ marginBottom: '1rem' }}>{earningsError}</p>
                                <button onClick={() => fetchEarnings()} className="btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}>Retry</button>
                            </div>
                        ) : earnings ? (
                            <>
                                {/* KPI row */}
                                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                                    {[
                                        { label: 'Earned (range)', value: `NAD ${earnings.totals.earned.toLocaleString()}`, icon: '💰', sub: `${earnings.totals.completedCount} completed` },
                                        { label: 'This month', value: `NAD ${earnings.thisMonth.earned.toLocaleString()}`, icon: '📅', sub: `${earnings.growthPct >= 0 ? '▲' : '▼'} ${Math.abs(earnings.growthPct)}% vs last month`, trend: earnings.growthPct },
                                        { label: 'Avg / appointment', value: `NAD ${earnings.totals.avgPerAppointment.toLocaleString()}`, icon: '📈', sub: 'In selected range' },
                                        { label: 'All-time earned', value: `NAD ${earnings.totals.allTimeEarned.toLocaleString()}`, icon: '🏆', sub: `${earnings.totals.allTimeCount} completed` },
                                    ].map((s, i) => (
                                        <div key={i} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(201,168,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>{s.icon}</div>
                                            <div>
                                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{s.label}</p>
                                                <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.4rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1.1 }}>{s.value}</p>
                                                {s.sub && <p style={{ fontSize: '0.72rem', color: s.trend !== undefined ? (s.trend >= 0 ? '#059669' : '#dc2626') : 'var(--text-muted)', marginTop: '0.25rem' }}>{s.sub}</p>}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Earnings over time */}
                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', marginBottom: '1.5rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)' }}>Earnings over time</h3>
                                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                                            {[['earned','Earnings'],['count','Bookings']].map(([k, lbl]) => (
                                                <button key={k} onClick={() => setEarningsChartMode(k)} style={{ padding: '0.3rem 0.8rem', borderRadius: '99px', border: '1.5px solid', borderColor: earningsChartMode === k ? 'var(--gold)' : 'var(--border)', background: earningsChartMode === k ? 'rgba(201,168,76,0.1)' : 'transparent', color: earningsChartMode === k ? 'var(--gold-dark)' : 'var(--text-muted)', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'Outfit, sans-serif' }}>{lbl}</button>
                                            ))}
                                        </div>
                                    </div>
                                    {(() => {
                                        const data = earnings.overTime;
                                        const max = Math.max(...data.map(d => d[earningsChartMode]), 1);
                                        return (
                                            <>
                                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '160px' }}>
                                                    {data.map((d, i) => (
                                                        <div key={i} title={`${d.label}: ${earningsChartMode === 'earned' ? 'NAD ' + d.earned : d.count + ' booking(s)'}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                                                            <div style={{ height: `${(d[earningsChartMode] / max) * 100}%`, minHeight: d[earningsChartMode] > 0 ? '3px' : '0', background: 'var(--gold)', borderRadius: '3px 3px 0 0', transition: 'height 0.4s ease' }} />
                                                        </div>
                                                    ))}
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{data[0]?.label}</span>
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{data[data.length - 1]?.label}</span>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>

                                {/* By service + by team */}
                                <div className="provider-profile-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                        <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Earnings by service</h3>
                                        {earnings.byService.length === 0 ? (
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No completed appointments in this range</p>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                                                {earnings.byService.map((s, i) => {
                                                    const max = earnings.byService[0]?.earned || 1;
                                                    return (
                                                        <div key={i}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                                                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: '500' }}>{s.name}</span>
                                                                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{s.count} job{s.count !== 1 ? 's' : ''}</span>
                                                                    <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--charcoal)' }}>NAD {s.earned.toLocaleString()}</span>
                                                                </div>
                                                            </div>
                                                            <div style={{ height: '6px', borderRadius: '99px', background: 'var(--warm-gray)', overflow: 'hidden' }}>
                                                                <div style={{ height: '100%', borderRadius: '99px', background: 'var(--gold)', width: `${(s.earned / max) * 100}%`, transition: 'width 0.5s ease' }} />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    {earnings.topClients.length > 0 && (
                                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                            <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Top clients</h3>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                                                {earnings.topClients.map((c, i) => (
                                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: i === 0 ? 'var(--gold)' : 'var(--warm-gray)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: '700', color: i === 0 ? 'var(--ink)' : 'var(--text-muted)', flexShrink: 0 }}>{i + 1}</div>
                                                        <div style={{ flex: 1 }}>
                                                            <p style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>{c.name}</p>
                                                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{c.count} visit{c.count !== 1 ? 's' : ''}</p>
                                                        </div>
                                                        <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--charcoal)' }}>NAD {c.earned.toLocaleString()}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Recent completed */}
                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                    <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                                        <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)' }}>Recent completed appointments</h3>
                                    </div>
                                    {earnings.recent.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}><p>No completed appointments yet</p></div>
                                    ) : (
                                        <div className="table-scroll">
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                                                <thead>
                                                    <tr style={{ background: 'var(--warm-gray)', borderBottom: '1px solid var(--border)' }}>
                                                        {['Client', 'Service', 'Date', 'Time', 'Amount'].map(h => (
                                                            <th key={h} style={{ padding: '0.875rem 1rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {earnings.recent.map((r) => (
                                                        <tr key={r._id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                            <td style={{ padding: '0.875rem 1rem', fontWeight: '600', color: 'var(--charcoal)' }}>{r.client}</td>
                                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{r.service}</td>
                                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{r.time}</td>
                                                            <td style={{ padding: '0.875rem 1rem', fontWeight: '700', color: 'var(--charcoal)' }}>NAD {r.amount.toLocaleString()}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}><p>No earnings data yet</p></div>
                        )}
                    </div>
                )}

                {/* Calendar tab */}'''

s = s.replace(anchor, block)
io.open(path, 'w', encoding='utf-8', newline='').write(s)
print('earnings tab inserted')

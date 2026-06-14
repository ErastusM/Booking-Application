# -*- coding: utf-8 -*-
import io, os
path = os.path.join(os.path.dirname(__file__), '..', 'src', 'pages', 'ProviderDashboard.js')
path = os.path.abspath(path)
s = io.open(path, encoding='utf-8').read()

anchor = "                {/* Earnings tab — value of completed appointments (reporting only) */}"
assert s.count(anchor) == 1, f"anchor count = {s.count(anchor)}"

block = r'''                {/* Insights tab — operational (non-financial) analytics */}
                {activeTab === 'insights' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
                            <div>
                                <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Insights</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>How busy you are, when, and who's coming back.</p>
                            </div>
                            <button onClick={exportInsightsCsv} disabled={!insights} style={{ padding: '0.5rem 1rem', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: insights ? 'pointer' : 'not-allowed', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', fontFamily: 'Outfit, sans-serif' }}>⬇ Export CSV</button>
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                            {[['week','This week'],['month','This month'],['lastMonth','Last month'],['30d','Last 30 days']].map(([key, label]) => (
                                <button key={key} onClick={() => { setInsightsPreset(key); fetchInsights(key); }} style={{
                                    padding: '0.4rem 1rem', borderRadius: '99px', border: '1.5px solid',
                                    borderColor: insightsPreset === key ? 'var(--gold)' : 'var(--border)',
                                    background: insightsPreset === key ? 'rgba(201,168,76,0.12)' : 'var(--card-bg)',
                                    color: insightsPreset === key ? 'var(--gold-dark)' : 'var(--text-secondary)',
                                    fontSize: '0.8rem', fontWeight: insightsPreset === key ? '600' : '400', cursor: 'pointer', fontFamily: 'Outfit, sans-serif',
                                }}>{label}</button>
                            ))}
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginLeft: '0.25rem' }}>
                                <input type="date" value={insightsRange.from} onChange={e => setInsightsRange(r => ({ ...r, from: e.target.value }))} className="input" style={{ fontSize: '0.78rem', padding: '0.35rem 0.5rem' }} />
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>–</span>
                                <input type="date" value={insightsRange.to} onChange={e => setInsightsRange(r => ({ ...r, to: e.target.value }))} className="input" style={{ fontSize: '0.78rem', padding: '0.35rem 0.5rem' }} />
                                <button onClick={() => { setInsightsPreset('custom'); fetchInsights('custom', insightsRange); }} disabled={!insightsRange.from || !insightsRange.to} style={{ padding: '0.4rem 0.85rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: '600', cursor: (insightsRange.from && insightsRange.to) ? 'pointer' : 'not-allowed', fontFamily: 'Outfit, sans-serif' }}>Apply</button>
                            </div>
                        </div>

                        {loadingInsights ? (
                            <div style={{ textAlign: 'center', padding: '4rem' }}>
                                <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
                            </div>
                        ) : insightsError ? (
                            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                                <p style={{ marginBottom: '1rem' }}>{insightsError}</p>
                                <button onClick={() => fetchInsights()} className="btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}>Retry</button>
                            </div>
                        ) : insights ? (
                            <>
                                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                                    {[
                                        { label: 'Utilization', value: `${insights.rates.utilizationPct}%`, icon: '⚡', sub: `${Math.round(insights.utilization.bookedMinutes / 60)}h booked` },
                                        { label: 'No-show rate', value: `${insights.rates.noShowRate}%`, icon: '🚫', sub: `${insights.totals.noShow} no-shows` },
                                        { label: 'New clients', value: insights.clients.new, icon: '✨', sub: `${insights.clients.returning} returning` },
                                        { label: 'Waitlist', value: insights.waitlistVolume, icon: '⏳', sub: 'Currently waiting' },
                                    ].map((s, i) => (
                                        <div key={i} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(201,168,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>{s.icon}</div>
                                            <div>
                                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{s.label}</p>
                                                <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.5rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1 }}>{s.value}</p>
                                                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{s.sub}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="provider-profile-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                        <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Peak hours</h3>
                                        {(() => {
                                            const max = Math.max(...insights.peakHours.map(h => h.count), 1);
                                            return (
                                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '140px' }}>
                                                    {insights.peakHours.map((h, i) => (
                                                        <div key={i} title={`${h.label}: ${h.count}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                                                            <div style={{ width: '100%', height: `${(h.count / max) * 100}%`, minHeight: h.count > 0 ? '3px' : '0', background: 'var(--gold)', borderRadius: '3px 3px 0 0', transition: 'height 0.4s ease' }} />
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        })()}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{insights.peakHours[0]?.label}</span>
                                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{insights.peakHours[insights.peakHours.length - 1]?.label}</span>
                                        </div>
                                    </div>

                                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                        <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Busiest days</h3>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                            {(() => {
                                                const max = Math.max(...insights.peakDays.map(d => d.count), 1);
                                                return insights.peakDays.map((d, i) => (
                                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                        <span style={{ fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)', width: '34px', flexShrink: 0, textTransform: 'capitalize' }}>{d.day}</span>
                                                        <div style={{ flex: 1, height: '8px', borderRadius: '99px', background: 'var(--warm-gray)', overflow: 'hidden' }}>
                                                            <div style={{ height: '100%', borderRadius: '99px', background: 'var(--gold)', width: `${(d.count / max) * 100}%`, transition: 'width 0.5s ease' }} />
                                                        </div>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: '20px', textAlign: 'right', flexShrink: 0 }}>{d.count}</span>
                                                    </div>
                                                ));
                                            })()}
                                        </div>
                                    </div>
                                </div>

                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                    <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem' }}>Bookings over time</h3>
                                    {(() => {
                                        const max = Math.max(...insights.overTime.map(d => d.count), 1);
                                        return (
                                            <>
                                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '150px' }}>
                                                    {insights.overTime.map((d, i) => (
                                                        <div key={i} title={`${d.label}: ${d.count}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                                                            <div style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? '3px' : '0', background: 'var(--charcoal)', borderRadius: '3px 3px 0 0', transition: 'height 0.4s ease' }} />
                                                        </div>
                                                    ))}
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{insights.overTime[0]?.label}</span>
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{insights.overTime[insights.overTime.length - 1]?.label}</span>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            </>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}><p>No insights yet</p></div>
                        )}
                    </div>
                )}

''' + anchor

s = s.replace(anchor, block)
io.open(path, 'w', encoding='utf-8', newline='').write(s)
print('insights tab inserted')

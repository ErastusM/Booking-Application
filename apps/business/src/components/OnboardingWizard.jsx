import React, { useState } from 'react';
import { authService } from '../services';

const TEAM_SIZES = ['Just me', '2–5', '6–10', '11–20', '20+'];
const LOCATION_TYPES = ['Fixed location', 'Mobile / travel to client', 'Both'];
const SOFTWARE_OPTIONS = ['None — using pen & paper', 'Spreadsheets', 'Generic calendar app', 'Another booking software', 'Other'];
const REFERRAL_OPTIONS = ['Google search', 'Social media', 'Friend / colleague', 'Advertisement', 'Other'];

const STEPS = [
    { id: 'welcome',   title: 'Welcome to Bookplus', subtitle: null },
    { id: 'name',      title: 'What\'s your business name?', subtitle: 'This is what clients will see when they find you on Bookplus.' },
    { id: 'team',      title: 'How big is your team?', subtitle: 'Count all staff who take appointments.' },
    { id: 'location',  title: 'Where do you work?', subtitle: 'This helps us show you to clients nearby.' },
    { id: 'address',   title: 'What\'s your address?', subtitle: 'Enter the address where clients visit you.' },
    { id: 'software',  title: 'What are you using now?', subtitle: 'How are you managing your appointments today?' },
    { id: 'referral',  title: 'How did you hear about us?', subtitle: null },
];

const pill = (selected, value, onClick) => (
    <button
        key={value}
        type="button"
        onClick={() => onClick(value)}
        style={{
            padding: '0.65rem 1.25rem',
            borderRadius: '99px',
            border: '1.5px solid',
            borderColor: selected === value ? 'var(--gold)' : 'var(--border)',
            background: selected === value ? 'rgba(240,62,22,0.12)' : 'white',
            color: selected === value ? 'var(--gold-dark)' : 'var(--text-secondary)',
            fontWeight: selected === value ? '600' : '400',
            fontFamily: 'var(--font-body)',
            fontSize: '0.9rem',
            cursor: 'pointer',
            transition: 'all 0.15s',
        }}
    >
        {value}
    </button>
);

const OnboardingWizard = ({ user, onComplete }) => {
    const [step, setStep] = useState(0);
    const [form, setForm] = useState({
        businessName: user?.name || '',
        teamSize: '',
        locationType: '',
        address: '',
        currentSoftware: '',
        referralSource: '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [geoLoading, setGeoLoading] = useState(false);

    const handleDetectLocation = () => {
        if (!navigator.geolocation) return;
        setGeoLoading(true);
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                try {
                    const { latitude, longitude } = pos.coords;
                    const res = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
                        { headers: { 'Accept-Language': 'en' } }
                    );
                    const data = await res.json();
                    const addr = data.address || {};
                    const parts = [
                        addr.road || addr.pedestrian,
                        addr.house_number,
                        addr.suburb || addr.neighbourhood,
                        addr.city || addr.town || addr.village,
                        addr.state,
                        addr.country,
                    ].filter(Boolean);
                    setForm(f => ({ ...f, address: parts.join(', ') }));
                } catch {
                    // silently fail
                } finally {
                    setGeoLoading(false);
                }
            },
            () => setGeoLoading(false),
            { timeout: 8000 }
        );
    };

    const totalSteps = STEPS.length;
    const progress = Math.round((step / (totalSteps - 1)) * 100);
    const current = STEPS[step];

    const canAdvance = () => {
        if (current.id === 'name') return form.businessName.trim().length > 0;
        if (current.id === 'team') return !!form.teamSize;
        if (current.id === 'location') return !!form.locationType;
        if (current.id === 'address') return form.locationType === 'Mobile / travel to client' || form.address.trim().length > 0;
        if (current.id === 'software') return !!form.currentSoftware;
        if (current.id === 'referral') return !!form.referralSource;
        return true;
    };

    const handleNext = async () => {
        if (step < totalSteps - 1) {
            setStep(s => s + 1);
        } else {
            setSaving(true);
            setError('');
            try {
                const res = await authService.completeProviderSetup(form);
                onComplete(res.data.data);
            } catch {
                setError('Something went wrong — please try again.');
                setSaving(false);
            }
        }
    };

    const handleSkip = () => {
        if (step < totalSteps - 1) setStep(s => s + 1);
    };

    const isOptional = (id) => ['address', 'software', 'referral'].includes(id);

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(4,5,5,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
        }}>
            <div style={{
                background: 'var(--card-bg)', borderRadius: 'var(--radius)',
                width: '100%', maxWidth: '520px',
                boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
                overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}>
                {/* Progress bar */}
                <div style={{ height: '4px', background: '#f0f0f0' }}>
                    <div style={{ height: '100%', width: `${progress}%`, background: 'var(--gold)', transition: 'width 0.4s ease' }} />
                </div>

                {/* Header */}
                <div style={{ padding: '2rem 2rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
                        Step {Math.max(step, 1)} of {totalSteps - 1}
                    </span>
                    {step > 0 && isOptional(current.id) && (
                        <button onClick={handleSkip} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', fontFamily: 'var(--font-body)' }}>
                            Skip
                        </button>
                    )}
                </div>

                {/* Body */}
                <div style={{ padding: '1.5rem 2rem 2rem', minHeight: '280px', display: 'flex', flexDirection: 'column' }}>

                    {/* WELCOME */}
                    {current.id === 'welcome' && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', flex: 1, justifyContent: 'center' }}>
                            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✂️</div>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.75rem' }}>
                                Welcome to Bookplus, {user?.name?.split(' ')[0]}!
                            </h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1.6, maxWidth: '360px' }}>
                                Let's get your business set up in under 2 minutes so clients can start booking you right away.
                            </p>
                        </div>
                    )}

                    {/* BUSINESS NAME */}
                    {current.id === 'name' && (
                        <div>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>{current.title}</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>{current.subtitle}</p>
                            <input
                                autoFocus
                                className="input"
                                placeholder="Your business name"
                                value={form.businessName}
                                onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && canAdvance() && handleNext()}
                                style={{ fontSize: '1rem' }}
                            />
                        </div>
                    )}

                    {/* TEAM SIZE */}
                    {current.id === 'team' && (
                        <div>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>{current.title}</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>{current.subtitle}</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                                {TEAM_SIZES.map(v => pill(form.teamSize, v, val => setForm(f => ({ ...f, teamSize: val }))))}
                            </div>
                        </div>
                    )}

                    {/* LOCATION TYPE */}
                    {current.id === 'location' && (
                        <div>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>{current.title}</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>{current.subtitle}</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {LOCATION_TYPES.map(v => (
                                    <button
                                        key={v} type="button"
                                        onClick={() => setForm(f => ({ ...f, locationType: v }))}
                                        style={{
                                            padding: '1rem 1.25rem', borderRadius: 'var(--radius-sm)',
                                            border: '1.5px solid',
                                            borderColor: form.locationType === v ? 'var(--gold)' : 'var(--border)',
                                            background: form.locationType === v ? 'rgba(240,62,22,0.08)' : 'white',
                                            textAlign: 'left', cursor: 'pointer',
                                            fontFamily: 'var(--font-body)', fontSize: '0.9rem',
                                            color: form.locationType === v ? 'var(--gold-dark)' : 'var(--text-secondary)',
                                            fontWeight: form.locationType === v ? '600' : '400',
                                            transition: 'all 0.15s',
                                        }}
                                    >{v}</button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ADDRESS */}
                    {current.id === 'address' && (
                        <div>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>{current.title}</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>{current.subtitle}</p>
                            {form.locationType === 'Mobile / travel to client' ? (
                                <div style={{ background: 'rgba(240,62,22,0.08)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1rem 1.25rem' }}>
                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                                        You travel to your clients — no fixed address needed. You can add a service area later in your profile.
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <button
                                        type="button"
                                        onClick={handleDetectLocation}
                                        disabled={geoLoading}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                                            padding: '0.6rem 1.1rem', marginBottom: '0.75rem',
                                            border: '1.5px solid var(--gold)', borderRadius: 'var(--radius-sm)',
                                            background: 'rgba(240,62,22,0.08)', color: 'var(--gold-dark)',
                                            fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: '0.875rem', fontWeight: '600',
                                            cursor: geoLoading ? 'not-allowed' : 'pointer', opacity: geoLoading ? 0.7 : 1,
                                        }}
                                    >
                                        {geoLoading
                                            ? <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid rgba(240,62,22,0.3)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                                            : '📡'
                                        }
                                        {geoLoading ? 'Detecting location…' : 'Use my current location'}
                                    </button>
                                    <textarea
                                        autoFocus
                                        className="input"
                                        placeholder="e.g. 12 Independence Ave, Windhoek, Namibia"
                                        value={form.address}
                                        onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                                        rows={3}
                                        style={{ fontSize: '0.95rem', resize: 'vertical' }}
                                    />
                                    <p style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>GPS fills the address — you can edit it before continuing.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* CURRENT SOFTWARE */}
                    {current.id === 'software' && (
                        <div>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>{current.title}</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>{current.subtitle}</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                                {SOFTWARE_OPTIONS.map(v => pill(form.currentSoftware, v, val => setForm(f => ({ ...f, currentSoftware: val }))))}
                            </div>
                        </div>
                    )}

                    {/* REFERRAL */}
                    {current.id === 'referral' && (
                        <div>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>How did you hear about us?</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>This helps us know where to focus — takes one second.</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                                {REFERRAL_OPTIONS.map(v => pill(form.referralSource, v, val => setForm(f => ({ ...f, referralSource: val }))))}
                            </div>
                        </div>
                    )}

                    {error && (
                        <p style={{ marginTop: '1rem', color: '#ef4444', fontSize: '0.85rem' }}>{error}</p>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '1.25rem 2rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button
                        type="button"
                        onClick={() => step > 0 && setStep(s => s - 1)}
                        disabled={step === 0}
                        style={{
                            background: 'none', border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)', padding: '0.6rem 1.25rem',
                            cursor: step === 0 ? 'default' : 'pointer',
                            color: step === 0 ? 'var(--border)' : 'var(--text-secondary)',
                            fontFamily: 'var(--font-body)', fontSize: '0.875rem',
                        }}
                    >← Back</button>

                    <button
                        type="button"
                        onClick={handleNext}
                        disabled={saving || (!canAdvance() && !isOptional(current.id))}
                        className="btn-primary"
                        style={{ padding: '0.65rem 1.75rem', fontSize: '0.95rem', opacity: (!canAdvance() && !isOptional(current.id)) ? 0.4 : 1 }}
                    >
                        {saving ? 'Saving...' : step === totalSteps - 1 ? 'Go to dashboard →' : step === 0 ? 'Get started' : 'Continue'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OnboardingWizard;

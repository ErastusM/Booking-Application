import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, CalendarCheck, Clock, Zap, ArrowRight } from 'lucide-react';
import { useAuthContext } from '../context/AuthContext';

const features = [
    { Icon: ShieldCheck, title: 'Trusted professionals', description: 'Top-rated providers across beauty, wellness, automotive, training and more.' },
    { Icon: CalendarCheck, title: 'Book in seconds', description: 'Pick a time and confirm instantly — no phone calls, no waiting rooms.' },
    { Icon: Clock, title: 'On your schedule', description: 'Early mornings or late evenings, find a slot that fits your day.' },
    { Icon: Zap, title: 'Instant confirmation', description: 'Real-time confirmations and reminders, straight to your inbox.' },
];

const About = () => {
    const { user } = useAuthContext();
    const isProvider = user?.role === 'provider';
    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100dvh' }}>
            {/* Hero */}
            <section style={{ position: 'relative', overflow: 'hidden', paddingTop: 'clamp(4rem, 10vh, 9rem)', paddingBottom: 'clamp(2rem, 5vh, 3.5rem)' }}>
                <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 45% at 50% 0%, rgba(240,62,22,0.14), transparent 70%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative', maxWidth: '760px', marginLeft: 'auto', marginRight: 'auto', textAlign: 'center' }}>
                    <p style={{ color: 'var(--gold-dark)', fontSize: '0.78rem', fontWeight: '700', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: '1rem' }}>About us</p>
                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.2rem, 5.5vw, 3.6rem)', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1.08, letterSpacing: '-0.02em', margin: 0 }}>
                        A local app to link <span style={{ color: 'var(--gold)' }}>everyone together</span>
                    </h1>
                </div>
            </section>

            {/* Story */}
            <section style={{ paddingBottom: 'clamp(3rem, 7vh, 5rem)' }}>
                <div className="container" style={{ maxWidth: '700px', marginLeft: 'auto', marginRight: 'auto' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', color: 'var(--text-secondary)', fontSize: '1.05rem', lineHeight: 1.75 }}>
                        <p>Bookplus started with a simple frustration: finding and booking a good local service in Namibia meant a string of phone calls, missed messages, and "just come in and we'll see." The people doing brilliant work — barbers, stylists, car washes, trainers, therapists — were often the hardest to actually reach.</p>
                        <p>We wanted to build <strong style={{ color: 'var(--charcoal)' }}>one local app that links everyone together</strong>: a single place where a customer can discover a business, see their work, and book a real time in seconds — and where a business can run their whole day from one elegant workspace.</p>
                        <p>That's the whole idea. Keep money and talent in the community, give small businesses the same polish as the big chains, and make booking feel effortless on both sides. Built in Namibia, for Namibia — growing one business at a time.</p>
                    </div>
                </div>
            </section>

            {/* Why Bookplus */}
            <section style={{ background: 'var(--card-bg)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: 'clamp(3rem, 7vh, 5rem) 0' }}>
                <div className="container">
                    <div style={{ textAlign: 'center', marginBottom: '2.75rem' }}>
                        <p style={{ color: 'var(--gold-dark)', fontSize: '0.78rem', fontWeight: '700', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Why us</p>
                        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.7rem, 4vw, 2.6rem)', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>Booking, done beautifully</h2>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1.25rem' }}>
                        {features.map(({ Icon, title, description }, i) => (
                            <div key={i} style={{ background: 'var(--off-white)', borderRadius: 'var(--radius-lg, 18px)', border: '1px solid var(--border)', padding: '1.75rem' }}>
                                <div style={{ width: '46px', height: '46px', borderRadius: '12px', background: 'rgba(240,62,22,0.12)', color: 'var(--gold-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.1rem' }}>
                                    <Icon size={22} strokeWidth={2} />
                                </div>
                                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: '700', color: 'var(--charcoal)', margin: '0 0 0.5rem' }}>{title}</h3>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.65, margin: 0 }}>{description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA */}
            <section style={{ padding: 'clamp(3rem, 7vh, 5rem) 0', textAlign: 'center' }}>
                <div className="container" style={{ maxWidth: '560px' }}>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.6rem, 4vw, 2.4rem)', fontWeight: '700', color: 'var(--charcoal)', margin: '0 0 1rem' }}>
                        {isProvider ? 'Grow your business with Bookplus' : 'Find your next appointment'}
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1.6, margin: '0 0 2rem' }}>
                        {isProvider
                            ? 'Manage your bookings, clients and calendar from one elegant workspace.'
                            : 'Browse trusted local businesses and book in seconds.'}
                    </p>
                    <Link to={user ? (isProvider ? '/dashboard' : '/services') : '/register'} className="btn-primary" style={{ fontSize: '1rem', padding: '0.9rem 2.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                        {user ? (isProvider ? 'Go to dashboard' : 'Browse providers') : 'Get started'} <ArrowRight size={18} strokeWidth={2} />
                    </Link>
                </div>
            </section>
        </div>
    );
};

export default About;

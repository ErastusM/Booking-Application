import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';

const stats = [
    { number: '500+', label: 'Happy Clients' },
    { number: '15+', label: 'Top Providers' },
    { number: '8', label: 'Years Experience' },
    { number: '4.9★', label: 'Average Rating' },
];

const features = [
    {
        icon: '✦',
        title: 'Trusted Professionals',
        description: 'Discover top-rated service providers across beauty, wellness, automotive, education, and more.',
    },
    {
        icon: '◈',
        title: 'Easy Scheduling',
        description: 'Book your perfect time slot in seconds. No phone calls, no waiting — just seamless online booking.',
    },
    {
        icon: '◇',
        title: 'Flexible Hours',
        description: 'Early mornings or late evenings, we work around your schedule so you never have to compromise.',
    },
    {
        icon: '◉',
        title: 'Instant Confirmation',
        description: 'Get real-time booking confirmation and updates straight to your account the moment things change.',
    },
];

const Home = () => {
    const { user } = useAuthContext();
    const heroRef = useRef(null);

    useEffect(() => {
        // Parallax effect on hero
        const handleScroll = () => {
            if (heroRef.current) {
                const scrolled = window.scrollY;
                heroRef.current.style.transform = `translateY(${scrolled * 0.4}px)`;
            }
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <div style={{ background: 'var(--off-white)' }}>

            {/* Hero */}
            <section style={{
                position: 'relative',
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
                background: 'var(--charcoal)',
            }}>
                {/* Background texture */}
                <div ref={heroRef} style={{
                    position: 'absolute',
                    inset: '-20%',
                    backgroundImage: `
                        radial-gradient(ellipse at 20% 50%, rgba(201,168,76,0.15) 0%, transparent 60%),
                        radial-gradient(ellipse at 80% 20%, rgba(201,168,76,0.08) 0%, transparent 50%),
                        repeating-linear-gradient(
                            45deg,
                            transparent,
                            transparent 60px,
                            rgba(255,255,255,0.01) 60px,
                            rgba(255,255,255,0.01) 61px
                        )
                    `,
                    zIndex: 0,
                }} />

                {/* Gold accent line */}
                <div style={{
                    position: 'absolute',
                    left: 0,
                    top: '15%',
                    bottom: '15%',
                    width: '3px',
                    background: 'linear-gradient(to bottom, transparent, var(--gold), transparent)',
                    zIndex: 1,
                }} />

                <div className="container" style={{ position: 'relative', zIndex: 2, paddingTop: '6rem', paddingBottom: '6rem' }}>
                    <div style={{ maxWidth: '680px' }}>

                        {/* Eyebrow */}
                        <div className="fade-up" style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            background: 'rgba(201,168,76,0.12)',
                            border: '1px solid rgba(201,168,76,0.3)',
                            borderRadius: '99px',
                            padding: '0.35rem 1rem',
                            marginBottom: '1.5rem',
                        }}>
                            <span style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                                Multi-Service Booking Platform
                            </span>
                        </div>

                        {/* Headline */}
                        <h1 className="fade-up fade-up-delay-1" style={{
                            fontFamily: 'Inter, sans-serif',
                            fontSize: 'clamp(2.8rem, 6vw, 5rem)',
                            fontWeight: '700',
                            color: 'white',
                            lineHeight: '1.1',
                            marginBottom: '1.5rem',
                        }}>
                            Book Better,{' '}
                            <span style={{
                                color: 'var(--gold)',
                                fontStyle: 'italic',
                            }}>
                                Live Easier
                            </span>
                        </h1>

                        {/* Subtitle */}
                        <p className="fade-up fade-up-delay-2" style={{
                            color: 'rgba(255,255,255,0.65)',
                            fontSize: '1.1rem',
                            lineHeight: '1.7',
                            marginBottom: '2.5rem',
                            maxWidth: '520px',
                            fontWeight: '300',
                        }}>
                            Book trusted providers for beauty, wellness, medical, events, training, and more.
                            No waiting rooms, no phone calls - just smooth booking on your schedule.
                        </p>

                        {/* CTAs */}
                        <div className="fade-up fade-up-delay-3" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            {user ? (
                                <Link to="/book-appointment" className="btn-primary" style={{ fontSize: '1rem', padding: '0.875rem 2rem' }}>
                                    Book Appointment →
                                </Link>
                            ) : (
                                <>
                                    <Link to="/register" className="btn-primary" style={{ fontSize: '1rem', padding: '0.875rem 2rem' }}>
                                        Get Started →
                                    </Link>
                                    <Link to="/services" style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        color: 'rgba(255,255,255,0.75)',
                                        textDecoration: 'none',
                                        fontSize: '1rem',
                                        fontWeight: '500',
                                        gap: '0.5rem',
                                        padding: '0.875rem 0',
                                        transition: 'color 0.2s',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'}
                                    onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.75)'}
                                    >
                                        View Services ↓
                                    </Link>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Scroll indicator */}
                <div style={{
                    position: 'absolute',
                    bottom: '2rem',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.5rem',
                    color: 'rgba(255,255,255,0.3)',
                    fontSize: '0.7rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    animation: 'fadeUp 1s ease 1s forwards',
                    opacity: 0,
                }}>
                    <span>Scroll</span>
                    <div style={{
                        width: '1px',
                        height: '40px',
                        background: 'linear-gradient(to bottom, rgba(201,168,76,0.6), transparent)',
                        animation: 'pulse 2s ease infinite',
                    }} />
                </div>
            </section>

            {/* Stats bar */}
            <section style={{
                background: 'var(--gold)',
                padding: '2rem 0',
            }}>
                <div className="container">
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: '1rem',
                        textAlign: 'center',
                    }}>
                        {stats.map((stat, i) => (
                            <div key={i} style={{ padding: '0.5rem' }}>
                                <div style={{
                                    fontFamily: 'Inter, sans-serif',
                                    fontSize: '2rem',
                                    fontWeight: '700',
                                    color: 'var(--charcoal)',
                                    lineHeight: 1,
                                }}>
                                    {stat.number}
                                </div>
                                <div style={{
                                    color: 'rgba(26,26,46,0.7)',
                                    fontSize: '0.85rem',
                                    fontWeight: '500',
                                    marginTop: '0.25rem',
                                }}>
                                    {stat.label}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Features */}
            <section className="section">
                <div className="container">
                    <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
                        <p style={{
                            color: 'var(--gold)',
                            fontSize: '0.8rem',
                            fontWeight: '600',
                            letterSpacing: '0.15em',
                            textTransform: 'uppercase',
                            marginBottom: '1rem',
                        }}>
                            Why Choose Us
                        </p>
                        <h2 style={{
                            fontFamily: 'Inter, sans-serif',
                            fontSize: 'clamp(1.8rem, 4vw, 3rem)',
                            fontWeight: '700',
                            color: 'var(--charcoal)',
                            marginBottom: '1rem',
                        }}>
                            The Bookplus Experience,{' '}
                            <span style={{ fontStyle: 'italic', color: 'var(--gold)' }}>Reimagined</span>
                        </h2>
                        <div className="gold-divider" style={{ margin: '0 auto' }} />
                    </div>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                        gap: '1.5rem',
                    }}>
                        {features.map((f, i) => (
                            <div key={i} className="card" style={{ padding: '2rem' }}>
                                <div style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '12px',
                                    background: 'rgba(201,168,76,0.1)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '1.4rem',
                                    color: 'var(--gold)',
                                    marginBottom: '1.25rem',
                                }}>
                                    {f.icon}
                                </div>
                                <h3 style={{
                                    fontFamily: 'Inter, sans-serif',
                                    fontSize: '1.2rem',
                                    fontWeight: '600',
                                    color: 'var(--charcoal)',
                                    marginBottom: '0.75rem',
                                }}>
                                    {f.title}
                                </h3>
                                <p style={{
                                    color: 'var(--text-secondary)',
                                    fontSize: '0.9rem',
                                    lineHeight: '1.7',
                                }}>
                                    {f.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA Banner */}
            <section style={{
                background: 'var(--charcoal)',
                padding: '5rem 0',
                position: 'relative',
                overflow: 'hidden',
            }}>
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage: 'radial-gradient(ellipse at 70% 50%, rgba(201,168,76,0.1) 0%, transparent 70%)',
                    pointerEvents: 'none',
                }} />
                <div className="container" style={{ position: 'relative', textAlign: 'center' }}>
                    <h2 style={{
                        fontFamily: 'Inter, sans-serif',
                        fontSize: 'clamp(1.8rem, 4vw, 2.8rem)',
                        fontWeight: '700',
                        color: 'white',
                        marginBottom: '1rem',
                    }}>
                        Ready to Book Anything?
                    </h2>
                    <p style={{
                        color: 'rgba(255,255,255,0.6)',
                        fontSize: '1rem',
                        marginBottom: '2rem',
                        fontWeight: '300',
                    }}>
                        Join customers and providers using Bookplus to book and grow every day.
                    </p>
                    <Link
                        to={user ? '/book-appointment' : '/register'}
                        className="btn-primary"
                        style={{ fontSize: '1rem', padding: '0.875rem 2.5rem' }}
                    >
                        {user ? 'Book Now →' : 'Create Account →'}
                    </Link>
                </div>
            </section>

            {/* Footer */}
            <footer style={{
                background: '#111122',
                padding: '2rem 0',
                borderTop: '1px solid rgba(201,168,76,0.15)',
            }}>
                <div className="container" style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '1rem',
                }}>
                    <span style={{
                        fontFamily: 'Inter, sans-serif',
                        color: 'var(--gold)',
                        fontSize: '1.2rem',
                        fontWeight: '700',
                    }}>
                        Bookplus
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem' }}>
                        © 2026 Bookplus. All rights reserved.
                    </span>
                </div>
            </footer>
        </div>
    );
};

export default Home;
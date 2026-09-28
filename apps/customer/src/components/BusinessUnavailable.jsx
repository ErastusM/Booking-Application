import React from 'react';
import { Link } from 'react-router-dom';
import { Store } from 'lucide-react';

// Shown on a business's profile link (/providers/:id or /b/:slug) while that
// business is suspended on Bookplus. It has disappeared from every listing and
// search; this page only explains the dead link and points somewhere useful.
const BusinessUnavailable = () => (
    <div style={{ minHeight: 'var(--page-min-h)', background: 'var(--off-white)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 16px' }}>
        <div role="status" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2rem 1.5rem', maxWidth: '420px', width: '100%', textAlign: 'center' }}>
            <div aria-hidden="true" style={{ width: '52px', height: '52px', borderRadius: '14px', background: 'rgba(240,62,22,0.12)', color: 'var(--gold-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                <Store size={24} strokeWidth={2} />
            </div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.4rem' }}>
                This business isn’t taking bookings
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.55, margin: '0 0 1.4rem' }}>
                It may be back soon. Find another business nearby.
            </p>
            <Link to="/" className="btn-primary" style={{ display: 'inline-block', padding: '0.7rem 1.4rem', textDecoration: 'none' }}>
                Explore businesses
            </Link>
        </div>
    </div>
);

export default BusinessUnavailable;

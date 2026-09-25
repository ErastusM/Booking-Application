import React, { useState } from 'react';
import { Copy, Check, Share2, ChevronDown } from 'lucide-react';

export const CUSTOMER_URL = (import.meta.env.VITE_CUSTOMER_URL || 'https://www.bookplus.pro').replace(/\/$/, '');

/** Public booking URL for a business, or for one team member of it. */
export const bookingUrl = (businessSlug, memberSlug = null) =>
    (businessSlug ? `${CUSTOMER_URL}/b/${businessSlug}${memberSlug ? `/${memberSlug}` : ''}` : '');

// Where a booking link earns bookings. Google's "Appointment links" and
// Instagram's bio link both take a plain URL, so a business gets a Book button
// on Google Search / Maps and Instagram today, without any integration.
const PLACES = [
    { where: 'Instagram', how: 'Edit profile → Links → Add external link. Or add a "Book now" link sticker to a story.' },
    { where: 'Google', how: 'In your Google Business Profile: Edit profile → Booking → add it as your appointment link. A "Book" button then shows on Search and Maps.' },
    { where: 'WhatsApp', how: 'Settings → Business tools → Profile → Website, and in your status or away message.' },
    { where: 'Facebook', how: 'Add a button → Book with you → link to website.' },
];

/**
 * The link itself with Copy and Share, plus a folded "where to put it" guide.
 * `url` empty → renders nothing (the caller explains why there is no link yet).
 */
const ShareBookingLink = ({ url, shareTitle, testId = 'booking-link' }) => {
    const [copied, setCopied] = useState(false);
    if (!url) return null;

    const copy = async () => {
        try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ }
    };
    const share = async () => {
        if (navigator.share) { try { await navigator.share({ title: shareTitle, url }); } catch { /* cancelled */ } }
        else copy();
    };
    const btn = { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', minHeight: '40px', padding: '0 0.9rem', fontSize: '0.82rem', fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer' };

    return (
        <div data-testid={testId}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span data-testid={`${testId}-url`} style={{ flex: '1 1 180px', minWidth: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
                <button type="button" onClick={copy} className="btn-outline" style={{ ...btn, color: copied ? '#16a34a' : undefined }}>
                    {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? 'Copied' : 'Copy'}
                </button>
                <button type="button" onClick={share} className="btn-primary" style={btn}>
                    <Share2 size={15} aria-hidden="true" />Share
                </button>
            </div>
            <details style={{ marginTop: '0.6rem' }}>
                <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', minHeight: '36px', fontSize: '0.82rem', fontWeight: 600, color: 'var(--gold-dark)' }}>
                    Where to put it <ChevronDown size={14} aria-hidden="true" />
                </summary>
                <ul style={{ margin: '0.25rem 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: '0.5rem' }}>
                    {PLACES.map((p) => (
                        <li key={p.where} style={{ fontSize: '0.82rem', lineHeight: 1.45, color: 'var(--text-secondary)' }}>
                            <strong style={{ color: 'var(--charcoal)' }}>{p.where}:</strong> {p.how}
                        </li>
                    ))}
                </ul>
            </details>
        </div>
    );
};

export default ShareBookingLink;

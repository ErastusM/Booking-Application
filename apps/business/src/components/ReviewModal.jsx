import React, { useState, useEffect } from 'react';
import { reviewService } from '../services';

const StarPicker = ({ rating, onRate }) => {
    const [hovered, setHovered] = useState(0);
    return (
        <div style={{ display: 'flex', gap: '0.35rem' }}>
            {[1, 2, 3, 4, 5].map(star => {
                const active = (hovered || rating) >= star;
                return (
                    <button
                        key={star}
                        type="button"
                        aria-label={`${star} star${star > 1 ? 's' : ''}`}
                        onClick={() => onRate(star)}
                        onMouseEnter={() => setHovered(star)}
                        onMouseLeave={() => setHovered(0)}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
                            fontSize: '2rem', lineHeight: 1, transition: 'transform var(--dur-fast,0.12s) ease, color 0.15s ease',
                            color: active ? 'var(--gold)' : 'var(--border)',
                            transform: hovered === star ? 'scale(1.15)' : 'none',
                        }}
                    >
                        ★
                    </button>
                );
            })}
        </div>
    );
};

const ReviewModal = ({ appointment, onClose, onSubmitted }) => {
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Lock background scroll + close on Escape while the modal is open
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
    }, [onClose]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (rating === 0) { setError('Please select a star rating'); return; }
        setLoading(true);
        setError('');
        try {
            await reviewService.createReview({ appointmentId: appointment._id, rating, comment });
            onSubmitted();
            onClose();
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to submit review');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(4,5,5,0.55)', backdropFilter: 'blur(3px)',
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                padding: '0', animation: 'fadeIn 0.18s ease',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                className="review-modal-card"
                style={{
                    background: 'var(--card-bg)', width: '100%', maxWidth: '440px',
                    borderRadius: '20px 20px 0 0', boxShadow: '0 -10px 40px rgba(0,0,0,0.25)',
                    padding: '1.5rem 1.5rem calc(1.5rem + env(safe-area-inset-bottom))',
                    animation: 'slideUp 0.24s var(--ease-out, cubic-bezier(0.16,1,0.3,1))',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>Leave a review</h2>
                    <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.6rem', lineHeight: 1, padding: '0 0.25rem' }}>×</button>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: '0 0 1.25rem' }}>
                    How was your <span style={{ fontWeight: '600', color: 'var(--charcoal)' }}>{appointment.service?.name}</span>?
                </p>

                {error && (
                    <div role="alert" style={{ background: 'var(--danger-bg,#fee2e2)', border: '1px solid #fca5a5', color: 'var(--danger-fg,#991b1b)', padding: '0.7rem 0.9rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.85rem' }}>{error}</div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Your rating</label>
                        <StarPicker rating={rating} onRate={setRating} />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Your review</label>
                        <textarea
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            rows="4"
                            maxLength={500}
                            placeholder="Tell us about your experience…"
                            className="input"
                            style={{ resize: 'vertical', fontFamily: 'var(--font-body)', width: '100%' }}
                        />
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right', margin: '0.25rem 0 0' }}>{comment.length}/500</p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
                        <button type="button" onClick={onClose} className="btn-outline" style={{ flex: 1 }}>Cancel</button>
                        <button type="submit" disabled={loading} className="btn-primary" style={{ flex: 1, opacity: loading ? 0.7 : 1 }}>
                            {loading ? 'Submitting…' : 'Submit review'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ReviewModal;

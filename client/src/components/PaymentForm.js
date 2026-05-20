import React, { useState } from 'react';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { paymentService } from '../services';

const PaymentForm = ({ appointmentId, amount, serviceName, onSuccess, onCancel }) => {
    const stripe = useStripe();
    const elements = useElements();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!stripe || !elements) return;

        setLoading(true);
        setError('');

        try {
            const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
                elements,
                redirect: 'if_required',
            });

            if (stripeError) {
                setError(stripeError.message);
                setLoading(false);
                return;
            }

            if (paymentIntent.status === 'succeeded') {
                await paymentService.confirmPayment(paymentIntent.id, appointmentId);
                onSuccess();
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Payment failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0,
            background: 'rgba(26,26,46,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '1rem',
            overflowY: 'auto',
        }}>
            <div style={{
                background: 'white', borderRadius: 'var(--radius)',
                padding: '2rem', width: '100%', maxWidth: '480px',
                boxShadow: 'var(--shadow-lg)',
                margin: 'auto',
            }}>
                {/* Header */}
                <div style={{ marginBottom: '1.5rem' }}>
                    <h2 style={{
                        fontFamily: 'Inter, sans-serif',
                        fontSize: '1.5rem', fontWeight: '700',
                        color: 'var(--charcoal)', marginBottom: '0.5rem',
                    }}>
                        Complete Payment
                    </h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                        You're booking: <strong style={{ color: 'var(--charcoal)' }}>{serviceName}</strong>
                    </p>
                </div>

                {/* Amount */}
                <div style={{
                    background: 'var(--warm-gray)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '1rem 1.25rem',
                    marginBottom: '1.5rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Total due today</span>
                    <span style={{
                        fontFamily: 'Inter, sans-serif',
                        fontSize: '1.5rem', fontWeight: '700',
                        color: 'var(--gold-dark)',
                    }}>
                        ${(amount / 100).toFixed(2)}
                    </span>
                </div>

                {/* Stripe Payment Element */}
                <form onSubmit={handleSubmit}>
                    <PaymentElement options={{ layout: 'tabs' }} />

                    {error && (
                        <div style={{
                            background: '#fee2e2', border: '1px solid #fca5a5',
                            color: '#991b1b', padding: '0.75rem 1rem',
                            borderRadius: 'var(--radius-sm)', marginTop: '1rem',
                            fontSize: '0.875rem',
                        }}>
                            {error}
                        </div>
                    )}

                    {/* Test card hint */}
                    <div style={{
                        background: 'rgba(201,168,76,0.08)',
                        border: '1px solid rgba(201,168,76,0.2)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.75rem 1rem',
                        marginTop: '1rem',
                        fontSize: '0.775rem',
                        color: 'var(--gold-dark)',
                    }}>
                        🧪 Test mode — use card <strong>4242 4242 4242 4242</strong>, any future date, any CVC
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                        <button
                            type="button"
                            onClick={onCancel}
                            style={{
                                flex: 1, padding: '0.875rem',
                                background: 'none', border: '1.5px solid var(--border)',
                                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                                color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif',
                                fontWeight: '600', fontSize: '0.9rem',
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !stripe}
                            className="btn-primary"
                            style={{ flex: 2, padding: '0.875rem' }}
                        >
                            {loading ? 'Processing...' : `Pay $${(amount / 100).toFixed(2)} →`}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PaymentForm;
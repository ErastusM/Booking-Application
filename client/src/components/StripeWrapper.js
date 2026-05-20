import React from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY);

const StripeWrapper = ({ children, clientSecret }) => {
    const options = {
        clientSecret,
        appearance: {
            theme: 'stripe',
            variables: {
                colorPrimary: '#c9a84c',
                colorBackground: '#ffffff',
                colorText: '#1a1a2e',
                colorDanger: '#ef4444',
                fontFamily: 'Inter, sans-serif',
                borderRadius: '8px',
            },
        },
    };

    return (
        <Elements stripe={stripePromise} options={options}>
            {children}
        </Elements>
    );
};

export default StripeWrapper;
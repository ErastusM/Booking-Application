import React from 'react';

const TermsOfService = () => {
    return (
        <div className="container" style={{ paddingTop: '8rem', paddingBottom: '4rem' }}>
            <h1 style={{ fontFamily: 'var(--font-body)', fontSize: '2rem', marginBottom: '1rem' }}>Terms of Service</h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                By using Bookplus, you agree to use the platform lawfully and respect booking and cancellation
                policies set by providers.
            </p>
        </div>
    );
};

export default TermsOfService;

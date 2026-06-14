import React from 'react';

const PrivacyPolicy = () => {
    return (
        <div className="container" style={{ paddingTop: '8rem', paddingBottom: '4rem' }}>
            <h1 style={{ fontFamily: 'var(--font-body)', fontSize: '2rem', marginBottom: '1rem' }}>Privacy Policy</h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                We collect only the information required to provide booking services and account management.
                Your data is processed securely and is not sold to third parties.
            </p>
        </div>
    );
};

export default PrivacyPolicy;

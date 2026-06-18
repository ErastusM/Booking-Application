import React from 'react';
import { Link } from 'react-router-dom';

const LAST_UPDATED = '18 June 2026';

const sectionTitle = { fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: '700', color: 'var(--charcoal)', margin: '2rem 0 0.6rem' };
const para = { color: 'var(--text-secondary)', lineHeight: 1.75, fontSize: '0.95rem', margin: '0 0 0.85rem' };
const li = { color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '0.95rem', marginBottom: '0.35rem' };

const PrivacyPolicy = () => {
    return (
        <div className="container" style={{ paddingTop: '7rem', paddingBottom: '4rem', maxWidth: '780px' }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.2rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.4rem' }}>Privacy Policy</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Last updated: {LAST_UPDATED}</p>

            <p style={para}>
                Bookplus ("Bookplus", "we", "us") operates an online booking platform that connects customers
                with service providers in Namibia. We respect your privacy and the right to privacy recognised
                under Article 13 of the Namibian Constitution. This policy explains what personal information we
                collect, how we use it, and the choices you have. It should be read together with our{' '}
                <Link to="/terms" style={{ color: 'var(--gold-dark)' }}>Terms of Service</Link>.
            </p>
            <p style={para}>
                We process personal information in line with applicable Namibian law, including the Electronic
                Transactions Act 4 of 2019, and we are committed to aligning with Namibia's developing data-
                protection framework. By creating an account you consent to the processing described here.
            </p>

            <h2 style={sectionTitle}>1. Information we collect</h2>
            <ul>
                <li style={li}><strong>Account details</strong> — name, email address, phone number, password (stored encrypted), and your role (customer or provider).</li>
                <li style={li}><strong>Provider details</strong> — business name, category, location/address, services, pricing, availability, and any portfolio images you upload.</li>
                <li style={li}><strong>Booking information</strong> — appointments, dates and times, notes, and booking history between you and a provider.</li>
                <li style={li}><strong>Payment information</strong> — wallet top-ups are funded directly with your provider (bank transfer, eWallet, PayToday or cash) and approved manually. Card payments are processed by our payment partner DPO Pay (DPO Group) and are coming soon; we do not store full card numbers on our servers.</li>
                <li style={li}><strong>Technical data</strong> — basic device, log and usage data needed to operate and secure the service.</li>
            </ul>

            <h2 style={sectionTitle}>2. How we use your information</h2>
            <ul>
                <li style={li}>To create and manage your account and authenticate you securely.</li>
                <li style={li}>To enable bookings, reminders, confirmations and communication between customers and providers.</li>
                <li style={li}>To process payments in Namibian Dollars (NAD) and prevent fraud.</li>
                <li style={li}>To provide support, improve the service, and keep the platform safe and lawful.</li>
            </ul>

            <h2 style={sectionTitle}>3. Consent and lawful basis</h2>
            <p style={para}>
                We process your information on the basis of your consent (given at sign-up), to perform the
                booking contract you enter into, and for our legitimate interest in running a safe service. You
                may withdraw consent at any time by closing your account, though this does not affect processing
                already carried out.
            </p>

            <h2 style={sectionTitle}>4. Sharing your information</h2>
            <ul>
                <li style={li}>With the <strong>provider you book</strong> (or the customer who books you) — the details needed to fulfil the appointment.</li>
                <li style={li}>With <strong>service partners</strong> who help us operate (e.g. payment processing, email, image hosting and notifications). These partners may process data outside Namibia.</li>
                <li style={li}>Where required by Namibian law, regulation, or a lawful request from a competent authority.</li>
            </ul>
            <p style={para}>We do <strong>not</strong> sell your personal information.</p>

            <h2 style={sectionTitle}>5. Cross-border processing</h2>
            <p style={para}>
                Some of our service partners store or process data on servers outside Namibia. Where this
                happens, we take reasonable steps to ensure your information remains protected to a standard
                consistent with this policy.
            </p>

            <h2 style={sectionTitle}>6. Data retention</h2>
            <p style={para}>
                We keep your information for as long as your account is active and as needed to provide the
                service, resolve disputes, and meet legal, accounting or tax obligations. You may request
                deletion of your account at any time (see your rights below).
            </p>

            <h2 style={sectionTitle}>7. Security</h2>
            <p style={para}>
                We use technical and organisational measures — including encryption of passwords, secure
                transport (HTTPS), and access controls — to protect your information. No system is completely
                secure, so we cannot guarantee absolute security.
            </p>

            <h2 style={sectionTitle}>8. Your rights</h2>
            <ul>
                <li style={li}>Access the personal information we hold about you.</li>
                <li style={li}>Request correction of inaccurate information (much of which you can edit in your profile).</li>
                <li style={li}>Request deletion of your account and associated personal data.</li>
                <li style={li}>Withdraw consent or object to certain processing.</li>
            </ul>

            <h2 style={sectionTitle}>9. Children</h2>
            <p style={para}>
                Bookplus is intended for users aged 18 and older. We do not knowingly collect information from
                children without the consent of a parent or guardian.
            </p>

            <h2 style={sectionTitle}>10. Cookies and local storage</h2>
            <p style={para}>
                We use local storage and similar technologies to keep you signed in and remember preferences
                (such as light/dark mode). These are necessary for the platform to function.
            </p>

            <h2 style={sectionTitle}>11. Changes to this policy</h2>
            <p style={para}>
                We may update this policy from time to time. Material changes will be reflected by the "Last
                updated" date above, and where appropriate we will notify you.
            </p>

            <h2 style={sectionTitle}>12. Contact us</h2>
            <p style={para}>
                Questions about this policy or your information? Contact us at{' '}
                <a href="mailto:info@bookplus.pro" style={{ color: 'var(--gold-dark)' }}>info@bookplus.pro</a>. Bookplus is operated in the Republic of Namibia.
            </p>
        </div>
    );
};

export default PrivacyPolicy;

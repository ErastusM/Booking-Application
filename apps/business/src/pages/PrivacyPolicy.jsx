import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

// Business-app privacy policy. Covers the personal information of the business
// owner and their staff who use this app; for the personal information of THEIR
// own customers, the provider is an independent controller (see the Business
// Terms) and this policy describes only what Bookplus does as platform operator.
const LAST_UPDATED = '27 August 2026';

const sectionTitle = { fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: '600', color: 'var(--charcoal)', margin: '2rem 0 0.6rem' };
const para = { color: 'var(--text-secondary)', lineHeight: 1.75, fontSize: '0.95rem', margin: '0 0 0.85rem' };
const li = { color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '0.95rem', marginBottom: '0.35rem' };

const PrivacyPolicy = () => {
    useEffect(() => {
        const prev = document.title;
        document.title = 'Privacy Policy | Bookplus for Business';
        return () => { document.title = prev; };
    }, []);

    return (
        <div className="container" style={{ paddingTop: 'clamp(4rem, 8vw, 7rem)', paddingBottom: '4rem', maxWidth: '780px' }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.2rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.4rem' }}>Business Privacy Policy</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Last updated: {LAST_UPDATED}</p>

            <p style={para}>
                Bookplus ("Bookplus", "we", "us") operates an online booking platform that connects customers with
                service providers in Namibia. This policy explains how we handle the personal information of business
                owners and their team who use the Bookplus for Business app. We respect your privacy and the right to
                privacy recognised under Article 13 of the Namibian Constitution. It should be read together with our{' '}
                <Link to="/terms" style={{ color: 'var(--gold-dark)' }}>Business Terms of Service</Link>.
            </p>
            <p style={para}>
                For the personal information of <strong>your own customers</strong> that you collect or access through
                the platform, you act as an independent controller (see the Terms). This policy describes what we do
                with personal information as the operator of the platform. We process it in line with applicable
                Namibian law, including the Electronic Transactions Act 4 of 2019, and we are committed to aligning
                with Namibia's developing data-protection framework. By creating an account you consent to the
                processing described here.
            </p>

            <h2 style={sectionTitle}>1. Information we collect</h2>
            <ul>
                <li style={li}><strong>Account details</strong> — for you and any staff you invite: name, email address, phone number, password (stored encrypted), and role (provider, staff or admin).</li>
                <li style={li}><strong>Business details</strong> — business name, category, location/address, services, pricing, working hours and availability, and any portfolio images you upload.</li>
                <li style={li}><strong>Operational data</strong> — bookings, staff schedules and shifts, time off, and earnings figures generated as you run your business on the platform.</li>
                <li style={li}><strong>Payment information</strong> — wallet top-ups are funded directly with you and approved manually. Card payments are processed by our payment partner DPO Pay (DPO Group) and are coming soon; we do not store full card numbers on our servers.</li>
                <li style={li}><strong>Technical data</strong> — basic device, log and usage data needed to operate and secure the service.</li>
            </ul>

            <h2 style={sectionTitle}>2. How we use your information</h2>
            <ul>
                <li style={li}>To create and manage your business account and your team's access, and to authenticate you securely.</li>
                <li style={li}>To list your business on the marketplace so customers can discover and book you.</li>
                <li style={li}>To enable bookings, reminders and confirmations, and communication between you and your customers.</li>
                <li style={li}>To process payments in Namibian Dollars (NAD) and prevent fraud.</li>
                <li style={li}>To provide support, improve the service, and keep the platform safe and lawful.</li>
            </ul>

            <h2 style={sectionTitle}>3. Consent and lawful basis</h2>
            <p style={para}>
                We process your information on the basis of your consent (given at sign-up), to perform our agreement
                with you, and for our legitimate interest in running a safe service. You may withdraw consent at any
                time by closing your account, though this does not affect processing already carried out.
            </p>

            <h2 style={sectionTitle}>4. Sharing your information</h2>
            <ul>
                <li style={li}>With <strong>customers who book you</strong> — the business and booking details needed to fulfil the appointment.</li>
                <li style={li}>With <strong>staff you invite</strong> — according to the permissions you grant them within your account.</li>
                <li style={li}>With <strong>service partners</strong> who help us operate (e.g. payment processing, email, image hosting and notifications). These partners may process data outside Namibia.</li>
                <li style={li}>Where required by Namibian law, regulation, or a lawful request from a competent authority.</li>
            </ul>
            <p style={para}>We do <strong>not</strong> sell your personal information.</p>

            <h2 style={sectionTitle}>5. Cross-border processing</h2>
            <p style={para}>
                Some of our service partners store or process data on servers outside Namibia. Where this happens, we
                take reasonable steps to ensure your information remains protected to a standard consistent with this
                policy.
            </p>

            <h2 style={sectionTitle}>6. Data retention</h2>
            <p style={para}>
                We keep your information for as long as your account is active and as needed to provide the service,
                resolve disputes, and meet legal, accounting or tax obligations. You may request deletion of your
                account at any time (see your rights below).
            </p>

            <h2 style={sectionTitle}>7. Security</h2>
            <p style={para}>
                We use technical and organisational measures — including encryption of passwords, secure transport
                (HTTPS), and access controls — to protect your information. No system is completely secure, so we
                cannot guarantee absolute security.
            </p>

            <h2 style={sectionTitle}>8. Your rights</h2>
            <ul>
                <li style={li}>Access the personal information we hold about you.</li>
                <li style={li}>Request correction of inaccurate information (much of which you can edit in your account).</li>
                <li style={li}>Request deletion of your account and associated personal data.</li>
                <li style={li}>Withdraw consent or object to certain processing.</li>
            </ul>

            <h2 style={sectionTitle}>9. Children</h2>
            <p style={para}>
                Bookplus is intended for users aged 18 and older. We do not knowingly collect information from children
                without the consent of a parent or guardian.
            </p>

            <h2 style={sectionTitle}>10. Cookies and local storage</h2>
            <p style={para}>
                We use local storage and similar technologies to keep you signed in and remember preferences (such as
                light/dark mode). These are necessary for the platform to function.
            </p>

            <h2 style={sectionTitle}>11. Changes to this policy</h2>
            <p style={para}>
                We may update this policy from time to time. Material changes will be reflected by the "Last updated"
                date above, and where appropriate we will notify you.
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

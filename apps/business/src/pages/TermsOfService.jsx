import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

// The business app hosts its own provider-facing legal pages: a provider's
// obligations (accurate listings, honouring bookings, handling their clients'
// data, fees and taxes) differ from a customer's, so the marketplace-site copy
// isn't the right agreement to put in front of someone listing a business.
const LAST_UPDATED = '27 August 2026';

const sectionTitle = { fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: '600', color: 'var(--charcoal)', margin: '2rem 0 0.6rem' };
const para = { color: 'var(--text-secondary)', lineHeight: 1.75, fontSize: '0.95rem', margin: '0 0 0.85rem' };
const li = { color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '0.95rem', marginBottom: '0.35rem' };

const TermsOfService = () => {
    useEffect(() => {
        const prev = document.title;
        document.title = 'Terms of Service | Bookplus for Business';
        return () => { document.title = prev; };
    }, []);

    return (
        <div className="container" style={{ paddingTop: 'clamp(4rem, 8vw, 7rem)', paddingBottom: '4rem', maxWidth: '780px' }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.2rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.4rem' }}>Business Terms of Service</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Last updated: {LAST_UPDATED}</p>

            <p style={para}>
                These Terms govern your use of Bookplus for Business — the provider and staff app operated in the
                Republic of Namibia that lets independent service providers take bookings, manage their calendar
                and team, and be discovered by customers on the Bookplus marketplace. By creating a business
                account or using the app, you agree to these Terms and to our{' '}
                <Link to="/privacy-policy" style={{ color: 'var(--gold-dark)' }}>Privacy Policy</Link>.
            </p>

            <h2 style={sectionTitle}>1. Eligibility and your account</h2>
            <ul>
                <li style={li}>You must be at least 18 and authorised to enter into a binding agreement on behalf of your business under Namibian law.</li>
                <li style={li}>You agree to provide accurate business and contact details and to keep them up to date.</li>
                <li style={li}>Keep your login credentials confidential; you are responsible for all activity under your account. Changing your password signs out other sessions.</li>
            </ul>

            <h2 style={sectionTitle}>2. Our role</h2>
            <p style={para}>
                Bookplus is a booking <strong>marketplace and intermediary</strong>. We provide the technology that
                lets customers discover you and make bookings, and that lets you run your schedule and team. We are
                <strong> not</strong> the provider of your services, are <strong>not</strong> party to the service
                agreement between you and your customers, and do <strong>not</strong> employ you or your staff. You
                operate as an independent business and are solely responsible for the services you offer.
            </p>

            <h2 style={sectionTitle}>3. Your listings and services</h2>
            <ul>
                <li style={li}>You are responsible for the accuracy of your listings, pricing, availability and the quality, safety and legality of your services.</li>
                <li style={li}>You must hold any licences, registrations or qualifications required to offer your services in Namibia.</li>
                <li style={li}>You set your own working hours, prices and cancellation and no-show policy, and you honour confirmed bookings.</li>
                <li style={li}>You are responsible for the accuracy of any portfolio images or content you upload and for your right to use it.</li>
            </ul>

            <h2 style={sectionTitle}>4. Your team</h2>
            <p style={para}>
                You may invite staff to access your account with the permissions you grant them. You are responsible
                for who you give access to, for their conduct within your account, and for removing access when a
                team member leaves. Deactivating or removing a team member ends their ability to sign in to your
                business.
            </p>

            <h2 style={sectionTitle}>5. Your customers' information</h2>
            <p style={para}>
                When you collect or access your customers' personal information through the platform (for example
                their name, contact details and booking history), you act as an <strong>independent controller</strong>
                {' '}of that information. You must handle it lawfully, use it only to provide and manage your services,
                keep it secure, and comply with applicable Namibian law. Our <Link to="/privacy-policy" style={{ color: 'var(--gold-dark)' }}>Privacy Policy</Link>{' '}
                describes what <em>we</em> do with personal information as the platform operator.
            </p>

            <h2 style={sectionTitle}>6. Payments, fees and taxes</h2>
            <p style={para}>
                Bookplus uses a prepaid wallet. Customers fund their wallet with you directly — by bank transfer,
                eWallet, PayToday or cash — and you approve the top-up. Card payments via our payment partner DPO Pay
                (DPO Group) are coming soon. Any platform, service or commission fees will be disclosed to you before
                they apply. You are responsible for your own taxes arising from your earnings on, or use of, the
                platform. All amounts are in Namibian Dollars (NAD).
            </p>

            <h2 style={sectionTitle}>7. Acceptable use</h2>
            <ul>
                <li style={li}>Do not use Bookplus for unlawful, fraudulent, harmful or misleading activity.</li>
                <li style={li}>Do not misuse, disrupt, scrape or attempt to gain unauthorised access to the platform.</li>
                <li style={li}>Do not post content that is unlawful, infringing, offensive or that you have no right to share.</li>
            </ul>

            <h2 style={sectionTitle}>8. Intellectual property</h2>
            <p style={para}>
                The Bookplus name, platform and content are owned by us or our licensors. Content you upload remains
                yours, but you grant us a licence to host and display it for the purpose of operating the service and
                showing your listing to customers on the marketplace.
            </p>

            <h2 style={sectionTitle}>9. Disclaimers and liability</h2>
            <p style={para}>
                The platform is provided "as is". To the maximum extent permitted by Namibian law, we are not liable
                for your services, for the acts or omissions of your customers or staff, or for indirect or
                consequential losses (including lost bookings or revenue). Nothing in these Terms limits liability
                that cannot be excluded by law.
            </p>

            <h2 style={sectionTitle}>10. Indemnity</h2>
            <p style={para}>
                You agree to indemnify Bookplus against claims and losses arising from your breach of these Terms,
                the services you provide, or your handling of your customers' personal information.
            </p>

            <h2 style={sectionTitle}>11. Suspension and termination</h2>
            <p style={para}>
                We may suspend or close accounts that breach these Terms or that pose a risk to other users. You may
                close your business account at any time; you remain responsible for honouring or properly cancelling
                any bookings already confirmed.
            </p>

            <h2 style={sectionTitle}>12. Governing law</h2>
            <p style={para}>
                These Terms are governed by the laws of the Republic of Namibia, and the Namibian courts have
                jurisdiction over any dispute.
            </p>

            <h2 style={sectionTitle}>13. Changes and contact</h2>
            <p style={para}>
                We may update these Terms from time to time; the "Last updated" date will change accordingly.
                Questions? Contact <a href="mailto:info@bookplus.pro" style={{ color: 'var(--gold-dark)' }}>info@bookplus.pro</a>.
            </p>
        </div>
    );
};

export default TermsOfService;

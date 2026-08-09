import React from 'react';
import { Link } from 'react-router-dom';
import Seo from '../components/Seo';

const LAST_UPDATED = '18 June 2026';

const sectionTitle = { fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: '600', color: 'var(--charcoal)', margin: '2rem 0 0.6rem' };
const para = { color: 'var(--text-secondary)', lineHeight: 1.75, fontSize: '0.95rem', margin: '0 0 0.85rem' };
const li = { color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '0.95rem', marginBottom: '0.35rem' };

const TermsOfService = () => {
    return (
        <div className="container" style={{ paddingTop: 'clamp(4rem, 8vw, 7rem)', paddingBottom: '4rem', maxWidth: '780px' }}>
            <Seo
                title="Terms of Service | Bookplus"
                description="The terms that govern your use of the Bookplus booking platform."
                url={(typeof window !== 'undefined' ? window.location.origin : 'https://www.bookplus.pro') + '/terms'}
            />
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.2rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.4rem' }}>Terms of Service</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Last updated: {LAST_UPDATED}</p>

            <p style={para}>
                These Terms govern your use of Bookplus, an online platform operated in the Republic of Namibia
                that connects customers with independent service providers. By creating an account or using the
                platform, you agree to these Terms and to our{' '}
                <Link to="/privacy-policy" style={{ color: 'var(--gold-dark)' }}>Privacy Policy</Link>.
            </p>

            <h2 style={sectionTitle}>1. Eligibility</h2>
            <p style={para}>
                You must be at least 18 years old and able to enter into a binding contract under Namibian law
                to use Bookplus. You agree to provide accurate information and to keep your account details up to date.
            </p>

            <h2 style={sectionTitle}>2. Our role</h2>
            <p style={para}>
                Bookplus is a booking <strong>marketplace and intermediary</strong>. We provide the technology
                that lets customers discover providers and make bookings. We are <strong>not</strong> the
                provider of the underlying services, are not party to the service agreement between a customer
                and a provider, and do not employ providers. Providers are independent and solely responsible
                for the services they offer.
            </p>

            <h2 style={sectionTitle}>3. Accounts and security</h2>
            <ul>
                <li style={li}>Keep your login credentials confidential; you are responsible for activity under your account.</li>
                <li style={li}>Notify us promptly of any unauthorised use. Changing your password signs out other sessions.</li>
            </ul>

            <h2 style={sectionTitle}>4. Customers</h2>
            <ul>
                <li style={li}>When you book, you agree to the price, time and the provider's cancellation and no-show policy.</li>
                <li style={li}>Prices are shown and charged in Namibian Dollars (NAD).</li>
                <li style={li}>Please arrive on time and cancel or reschedule with reasonable notice.</li>
            </ul>

            <h2 style={sectionTitle}>5. Providers</h2>
            <ul>
                <li style={li}>You are responsible for the accuracy of your listings, pricing, availability and the quality and legality of your services.</li>
                <li style={li}>You must hold any licences, registrations or qualifications required to offer your services in Namibia.</li>
                <li style={li}>You set your own working hours, prices and cancellation policy, and you honour confirmed bookings.</li>
            </ul>

            <h2 style={sectionTitle}>6. Payments and fees</h2>
            <p style={para}>
                Bookplus uses a prepaid wallet. You fund your wallet with a provider directly — by bank transfer,
                eWallet, PayToday or cash — and the provider approves the top-up. Card payments via our payment
                partner DPO Pay (DPO Group) are coming soon. Any platform or service fees will be disclosed to you
                before they apply. You are responsible for your own taxes arising from your use of, or earnings on,
                the platform. All amounts are in Namibian Dollars (NAD).
            </p>

            <h2 style={sectionTitle}>7. Acceptable use</h2>
            <ul>
                <li style={li}>Do not use Bookplus for unlawful, fraudulent, harmful or misleading activity.</li>
                <li style={li}>Do not misuse, disrupt, scrape or attempt to gain unauthorised access to the platform.</li>
                <li style={li}>Do not post content that is unlawful, infringing, offensive or that you have no right to share.</li>
            </ul>

            <h2 style={sectionTitle}>8. Intellectual property</h2>
            <p style={para}>
                The Bookplus name, platform and content are owned by us or our licensors. Content you upload
                remains yours, but you grant us a licence to host and display it for the purpose of operating the service.
            </p>

            <h2 style={sectionTitle}>9. Disclaimers and liability</h2>
            <p style={para}>
                The platform is provided "as is". To the maximum extent permitted by Namibian law, we are not
                liable for the acts, omissions, quality or safety of services provided by independent providers,
                nor for indirect or consequential losses. Nothing in these Terms limits liability that cannot be
                excluded by law.
            </p>

            <h2 style={sectionTitle}>10. Indemnity</h2>
            <p style={para}>
                You agree to indemnify Bookplus against claims and losses arising from your breach of these Terms
                or your misuse of the platform.
            </p>

            <h2 style={sectionTitle}>11. Suspension and termination</h2>
            <p style={para}>
                We may suspend or close accounts that breach these Terms or that pose a risk to other users. You
                may close your account at any time.
            </p>

            <h2 style={sectionTitle}>12. Governing law</h2>
            <p style={para}>
                These Terms are governed by the laws of the Republic of Namibia, and the Namibian courts have
                jurisdiction over any dispute, subject to any non-waivable consumer rights you may have.
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

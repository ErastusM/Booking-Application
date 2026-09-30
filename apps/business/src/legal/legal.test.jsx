import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CompanyDetails, LegalDocument } from '@bookplus/ui';
import { COMPANY, isPlaceholder, missingCompanyFields, companyValue, operatorName, mailLink, companyPhones, phoneLinks } from '@bookplus/config/legal/company.mjs';
import { privacyPolicy, RETENTION } from '@bookplus/config/legal/privacy.mjs';
import { termsOfService } from '@bookplus/config/legal/terms.mjs';
import { legalNotice } from '@bookplus/config/legal/notice.mjs';
import { LEGAL_CURRENCIES } from '@bookplus/config/legal/currencies.mjs';
import { legalDetailsPlugin } from '@bookplus/config/legal/buildCheck.mjs';
import LegalNotice from '../pages/LegalNotice';
import ComingSoon from '../components/ComingSoon';
import { FEATURES, WALLET_COMING_SOON_LINE } from '@bookplus/config/features.mjs';

/**
 * The legal pages (compliance scorecard points 3, 4, 7, 12, 13, 16 and 18).
 *
 * The operator's details come from ONE config file. A detail that is ever
 * emptied or replaced by a "[placeholder]" must never reach a user: the page
 * shows "details coming soon" instead and the production build warns. None of
 * these tests fail because a detail is missing — they check the mechanism.
 */

// Every string in a document, flattened, for content checks.
const textOf = (doc) => JSON.stringify(doc);

describe('company details guard', () => {
    it('treats empty and bracketed values as placeholders', () => {
        expect(isPlaceholder('[Legal entity name]')).toBe(true);
        expect(isPlaceholder('P.O. Box [number], Swakopmund')).toBe(true);
        expect(isPlaceholder('')).toBe(true);
        expect(isPlaceholder(null)).toBe(true);
        expect(isPlaceholder('Bookplus Digital Solutions CC')).toBe(false);
    });

    it('lists missing fields and never returns a placeholder value', () => {
        const draft = { ...COMPANY, legalName: '[Legal entity name]', phones: [] };
        expect(missingCompanyFields(draft)).toEqual(expect.arrayContaining(['Legal entity name', 'Phone']));
        expect(companyValue('legalName', draft)).toBeNull();
        expect(operatorName(draft)).toBe('Bookplus');
    });

    it('contact email links never carry a placeholder', () => {
        expect(mailLink('email', { ...COMPANY, email: '[Contact email]' })).not.toMatch(/mailto:/);
        expect(mailLink('email', { ...COMPANY, email: '[Contact email]' })).toContain('[Legal notice](/legal)');
        expect(mailLink('privacyEmail', { ...COMPANY, privacyEmail: '' })).toBe(`[${COMPANY.email}](mailto:${COMPANY.email})`);
    });

    it('the build warns about placeholders but does not fail', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const plugin = legalDetailsPlugin({ ...COMPANY, registrationNumber: '[Registration number]' });
        expect(() => plugin.buildStart()).not.toThrow();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Registration number'));
        warn.mockClear();
        legalDetailsPlugin({ ...COMPANY, registrationNumber: 'CC/2026/06325' }).buildStart();
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('company details still missing'));
    });

    it('hides placeholders from users and shows "details coming soon"', () => {
        render(<CompanyDetails company={{ ...COMPANY, legalName: '[Legal entity name]', registrationNumber: '[Registration number]' }} />);
        const box = screen.getByTestId('company-details');
        expect(box.textContent).not.toMatch(/\[/);
        expect(screen.getByTestId('company-details-pending')).toHaveTextContent(/details coming soon/i);
        expect(box).toHaveTextContent(COMPANY.email);
    });

    it('with complete details shows them all and no fallback', () => {
        render(<CompanyDetails company={{ ...COMPANY, legalName: 'Acme Bookings CC', registrationNumber: 'CC/2000/1', phones: ['+264 61 000 000'], email: 'a@b.c', privacyContact: 'Info Officer' }} />);
        const box = screen.getByTestId('company-details');
        expect(box).toHaveTextContent('Acme Bookings CC');
        expect(box).toHaveTextContent('CC/2000/1');
        expect(screen.queryByTestId('company-details-pending')).toBeNull();
    });
});

describe('support phone numbers', () => {
    const PHONES = ['+264 81 684 4677', '+264 81 281 9840'];
    const TELS = ['tel:+264816844677', 'tel:+264812819840'];

    it('both support lines are configured', () => {
        expect(companyPhones()).toEqual(PHONES);
    });

    it('a placeholder entry is hidden, and warned about, without hiding the other', () => {
        const draft = { ...COMPANY, phones: ['+264 81 684 4677', '[Second phone]'] };
        expect(companyPhones(draft)).toEqual(['+264 81 684 4677']);
        expect(missingCompanyFields(draft)).toContain('Phone');
        expect(missingCompanyFields({ ...COMPANY, phones: [] })).toContain('Phone');
        expect(missingCompanyFields()).not.toContain('Phone');
        expect(phoneLinks(draft)).toBe('[+264 81 684 4677](tel:+264816844677)');
        expect(phoneLinks({ ...COMPANY, phones: [] })).toBe('');
    });

    it('the company details box shows each number as its own tel: link', () => {
        render(<CompanyDetails company={COMPANY} />);
        const box = screen.getByTestId('company-details');
        PHONES.forEach((p, i) => expect(within(box).getByText(p).closest('a')).toHaveAttribute('href', TELS[i]));
    });

    it('the legal notice, Privacy Policy and Terms all give both numbers as tel: links', () => {
        const docs = [legalNotice('customer'), legalNotice('business'), privacyPolicy('customer'), privacyPolicy('business'), termsOfService('customer'), termsOfService('business')];
        for (const d of docs) {
            const t = textOf(d);
            PHONES.forEach((p, i) => expect(t).toContain(`[${p}](${TELS[i]})`));
        }
    });

    it('rendered legal notice links both numbers', () => {
        render(<MemoryRouter><LegalNotice /></MemoryRouter>);
        const contact = within(document.getElementById('contact'));
        PHONES.forEach((p, i) => expect(contact.getByText(p).closest('a')).toHaveAttribute('href', TELS[i]));
    });
});

describe('the "Who we are" page', () => {
    it('renders the configured operator details with no placeholder text', () => {
        render(<MemoryRouter><LegalNotice /></MemoryRouter>);
        const box = screen.getByTestId('company-details');
        for (const key of ['legalName', 'registrationNumber', 'email']) {
            const v = companyValue(key);
            if (v) expect(box).toHaveTextContent(v);
        }
        expect(screen.getByTestId('legal-document').textContent).not.toMatch(/\[[^\]]*\]/);
    });
});

// The only registered address is a private home: no street or postal address
// is ever published; written contact is the email (owner's instruction).
describe('no private address is published', () => {
    const ADDRESS = /Mahetago|Erf\s*\d|Yashilongo|P\.?\s*O\.?\s*Box|Registered office|Postal address|registered office at/i;

    it('the company details carry no address fields', () => {
        expect(COMPANY).not.toHaveProperty('registeredOffice');
        expect(COMPANY).not.toHaveProperty('postalAddress');
        expect(missingCompanyFields()).toEqual([]);
    });

    it('no legal document mentions an address', () => {
        const docs = [legalNotice('customer'), legalNotice('business'), privacyPolicy('customer'), privacyPolicy('business'), termsOfService('customer'), termsOfService('business')];
        for (const d of docs) expect(textOf(d)).not.toMatch(ADDRESS);
    });

    it('the "Who we are" page shows no address, no "coming soon", and the email to write to', () => {
        render(<MemoryRouter><LegalNotice /></MemoryRouter>);
        const box = screen.getByTestId('company-details');
        expect(box.textContent).not.toMatch(ADDRESS);
        expect(screen.getByTestId('legal-document').textContent).not.toMatch(ADDRESS);
        expect(screen.queryByTestId('company-details-pending')).toBeNull();
        const mails = within(box).getAllByText('info@bookplus.pro');
        expect(mails.length).toBeGreaterThan(0);
        mails.forEach((m) => expect(m.closest('a')).toHaveAttribute('href', 'mailto:info@bookplus.pro'));
    });

    it('an address passed in by mistake is still not shown', () => {
        render(<CompanyDetails company={{ ...COMPANY, registeredOffice: 'Erf 1442 Mahetago', postalAddress: 'P.O. Box 906' }} />);
        expect(screen.getByTestId('company-details').textContent).not.toMatch(ADDRESS);
    });
});

describe('Privacy Policy content matches what the platform does', () => {
    for (const audience of ['customer', 'business']) {
        it(`${audience}: names every processor, sensitive data type and retention period`, () => {
            const t = textOf(privacyPolicy(audience));
            for (const name of ['Cloudinary', 'Resend', 'Sentry', 'Google', 'OpenStreetMap', 'DigitalOcean']) expect(t).toContain(name);
            for (const topic of ['bp_sid', 'bp_rt', 'GPS', 'allergy', 'intake', 'health', 'Reviews', 'Messages']) expect(t.toLowerCase()).toContain(topic.toLowerCase());
            for (const period of Object.values(RETENTION)) expect(t).toContain(period);
            expect(t).toContain('16 and older');
            expect(t).toMatch(/Access and export/);
            expect(t).toMatch(/International transfers/);
            expect(t).not.toMatch(/\[[A-Z][^\]]*\](?!\()/); // no "[Placeholder]" (links are "[text](href)")
        });
    }

    it('renders as a numbered document with section anchors', () => {
        render(<MemoryRouter><LegalDocument doc={privacyPolicy('customer')} company={COMPANY} /></MemoryRouter>);
        expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
        expect(document.getElementById('retention')).not.toBeNull();
        expect(screen.getByRole('heading', { level: 2, name: /How long we keep it/ })).toBeInTheDocument();
    });
});

// The payment provider's review treats any wallet as a marketplace feature, so
// while it is switched off the legal text doesn't mention it at all.
describe('no wallet in the legal text while it is switched off', () => {
    it('the wallet is switched off by default', () => {
        expect(FEATURES.walletEnabled).toBe(false);
    });

    it('Terms, Privacy Policy and Legal Notice (client and business) never mention a wallet, gift cards or top-ups', () => {
        for (const audience of ['customer', 'business']) {
            expect(termsOfService(audience).sections.find((sec) => sec.id === 'wallet')).toBeUndefined();
            for (const doc of [termsOfService(audience), privacyPolicy(audience), legalNotice(audience)]) {
                expect(textOf(doc)).not.toMatch(/wallet|gift card|top-up|top up|prepaid/i);
            }
        }
        expect(textOf(termsOfService('customer'))).toMatch(/You pay the business directly at your appointment/);
        // The full wallet terms are kept for when it is switched on.
        expect(termsOfService('customer', { walletEnabled: true }).sections.find((sec) => sec.id === 'wallet').title).toBe('The prepaid wallet');
    });

    it('Privacy Policy drops wallet transactions and proofs of payment', () => {
        for (const audience of ['customer', 'business']) {
            const t = textOf(privacyPolicy(audience));
            expect(t).not.toMatch(/proof/i);
            expect(t).not.toMatch(/top-up|reservations, deductions/i);
        }
        const on = textOf(privacyPolicy('customer', { walletEnabled: true }));
        expect(on).toMatch(/proof-of-payment/);
    });
});

describe('ComingSoon', () => {
    it('shows the badge, title, line and any read-only content', () => {
        render(<ComingSoon title="Wallet — coming soon" line={WALLET_COMING_SOON_LINE}><p>Your balance with X: N$10.00</p></ComingSoon>);
        const box = screen.getByTestId('coming-soon');
        expect(box).toHaveTextContent('Coming soon');
        expect(box).toHaveTextContent('Wallet — coming soon');
        expect(box).toHaveTextContent('Pay at your appointment for now.');
        expect(box).toHaveTextContent('Your balance with X: N$10.00');
    });
});

describe('Terms of Service content', () => {
    it('names every pricing currency instead of "Namibian Dollars only"', () => {
        for (const audience of ['customer', 'business']) {
            const t = textOf(termsOfService(audience));
            for (const [code] of LEGAL_CURRENCIES) expect(t).toContain(`(${code})`);
            expect(t).not.toMatch(/charged in Namibian Dollars|All amounts are in Namibian Dollars/);
        }
    });

    it('keeps the full wallet terms for when the wallet is switched back on', () => {
        const t = textOf(termsOfService('customer', { walletEnabled: true }));
        expect(t).toMatch(/non-refundable/);
        expect(t).toMatch(/6, 12 or 24 months without any wallet activity/);
        expect(t).toMatch(/30 days and 7 days before/);
    });

    it('explains cancellations and the marketplace role', () => {
        const t = textOf(termsOfService('customer'));
        expect(t).toMatch(/No-shows/);
        expect(t).toMatch(/The business provides the service, not Bookplus/);
        expect(t).toContain(operatorName());
        expect(t).toMatch(/Reviews/);
        const ids = termsOfService('customer').sections.map((s) => s.id);
        expect(ids).toEqual(expect.arrayContaining(['cancellations', 'responsibility', 'disputes', 'termination', 'acceptable-use', 'reviews']));
    });

    it('has no liability cap or exclusion (removed pending legal advice), but keeps the platform role and consumer rights', () => {
        for (const audience of ['customer', 'business']) {
            const t = textOf(termsOfService(audience));
            expect(t).not.toMatch(/N\$1,000|total liability|limited to direct loss/i);
            expect(t).not.toMatch(/not liable|as is|indirect or consequential|not responsible for|governed by|jurisdiction|compensate bookplus|indemnif/i);
            expect(t).toMatch(/Nothing in these Terms takes away any right/);
        }
        expect(textOf(termsOfService('customer'))).toMatch(/The business provides the service, not Bookplus/);
        expect(textOf(termsOfService('business'))).toMatch(/You provide your services to your clients; Bookplus does not/);
    });

    it('business terms keep the anchor the privacy policy links to', () => {
        expect(termsOfService('business').sections.map((s) => s.id)).toContain('your-clients');
    });

    it('the legal notice links to both documents', () => {
        const t = textOf(legalNotice('business'));
        expect(t).toContain('(/terms)');
        expect(t).toContain('(/privacy-policy)');
    });
});

describe('inline links', () => {
    it('internal links go through the router, mail links stay plain', () => {
        const doc = { title: 'T', sections: [{ id: 'a', title: 'A', blocks: ['See [Terms](/terms) or email [us](mailto:x@y.z).'] }] };
        render(<MemoryRouter><LegalDocument doc={doc} renderLink={(href, children, key) => <a key={key} data-router="1" href={href}>{children}</a>} /></MemoryRouter>);
        const sec = within(document.getElementById('a'));
        expect(sec.getByText('Terms')).toHaveAttribute('data-router', '1');
        expect(sec.getByText('us')).toHaveAttribute('href', 'mailto:x@y.z');
    });
});

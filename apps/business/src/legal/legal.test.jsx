import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CompanyDetails, LegalDocument } from '@bookplus/ui';
import { COMPANY, isPlaceholder, missingCompanyFields, companyValue, operatorName } from '@bookplus/config/legal/company.mjs';
import { privacyPolicy, RETENTION } from '@bookplus/config/legal/privacy.mjs';
import { termsOfService } from '@bookplus/config/legal/terms.mjs';
import { legalNotice } from '@bookplus/config/legal/notice.mjs';
import { LEGAL_CURRENCIES } from '@bookplus/config/legal/currencies.mjs';
import { legalDetailsPlugin } from '@bookplus/config/legal/buildCheck.mjs';
import LegalNotice from '../pages/LegalNotice';

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
        const draft = { ...COMPANY, legalName: '[Legal entity name]', phone: '' };
        expect(missingCompanyFields(draft)).toEqual(expect.arrayContaining(['Legal entity name', 'Phone']));
        expect(companyValue('legalName', draft)).toBeNull();
        expect(operatorName(draft)).toBe('Bookplus');
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
        render(<CompanyDetails company={{ ...COMPANY, legalName: 'Acme Bookings CC', registrationNumber: 'CC/2000/1', registeredOffice: '1 Main St', phone: '+264 61 000 000', email: 'a@b.c', privacyContact: 'Info Officer' }} />);
        const box = screen.getByTestId('company-details');
        expect(box).toHaveTextContent('Acme Bookings CC');
        expect(box).toHaveTextContent('CC/2000/1');
        expect(screen.queryByTestId('company-details-pending')).toBeNull();
    });
});

describe('the "Who we are" page', () => {
    it('renders the configured operator details with no placeholder text', () => {
        render(<MemoryRouter><LegalNotice /></MemoryRouter>);
        const box = screen.getByTestId('company-details');
        for (const key of ['legalName', 'registrationNumber', 'registeredOffice', 'phone', 'email']) {
            const v = companyValue(key);
            if (v) expect(box).toHaveTextContent(v);
        }
        expect(screen.getByTestId('legal-document').textContent).not.toMatch(/\[[^\]]*\]/);
    });
});

describe('Privacy Policy content matches what the platform does', () => {
    for (const audience of ['customer', 'business']) {
        it(`${audience}: names every processor, sensitive data type and retention period`, () => {
            const t = textOf(privacyPolicy(audience));
            for (const name of ['Cloudinary', 'Resend', 'Sentry', 'Google', 'OpenStreetMap', 'DigitalOcean']) expect(t).toContain(name);
            for (const topic of ['bp_sid', 'bp_rt', 'GPS', 'allergy', 'intake', 'health', 'proof-of-payment', 'Reviews', 'Messages', 'wallet']) expect(t.toLowerCase()).toContain(topic.toLowerCase());
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

describe('Terms of Service content', () => {
    it('names every pricing currency instead of "Namibian Dollars only"', () => {
        for (const audience of ['customer', 'business']) {
            const t = textOf(termsOfService(audience));
            for (const [code] of LEGAL_CURRENCIES) expect(t).toContain(`(${code})`);
            expect(t).not.toMatch(/charged in Namibian Dollars|All amounts are in Namibian Dollars/);
        }
    });

    it('explains wallet refunds and expiry, cancellations, the marketplace role and Namibian law', () => {
        const t = textOf(termsOfService('customer'));
        expect(t).toMatch(/non-refundable/);
        expect(t).toMatch(/6, 12 or 24 months without any wallet activity/);
        expect(t).toMatch(/30 days and 7 days before/);
        expect(t).toMatch(/No-shows/);
        expect(t).toMatch(/The business provides the service, not Bookplus/);
        expect(t).toMatch(/Republic of Namibia/);
        expect(t).toContain(operatorName());
        expect(t).toMatch(/Reviews/);
        const ids = termsOfService('customer').sections.map((s) => s.id);
        expect(ids).toEqual(expect.arrayContaining(['wallet', 'cancellations', 'liability', 'law', 'disputes', 'termination', 'acceptable-use', 'reviews']));
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

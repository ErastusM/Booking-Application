import { COMPANY, missingCompanyFields } from './company.mjs';

// Build-time check of the operator details shown on the legal pages
// (legal/company.mjs). It WARNS and never fails the build: a missing detail is
// hidden from users behind a "details coming soon" line, but it should be filled
// in before a production deploy.
export const legalDetailsPlugin = (company = COMPANY) => ({
    name: 'bookplus-legal-details',
    apply: 'build',
    buildStart() {
        const missing = missingCompanyFields(company);
        if (missing.length) {
            // eslint-disable-next-line no-console
            console.warn(
                `\n[bookplus] WARNING: company details still missing in packages/config/legal/company.mjs: ${missing.join(', ')}.\n` +
                '[bookplus] They are hidden on the legal pages ("details coming soon"). Fill them in before deploying.\n'
            );
        }
    },
});

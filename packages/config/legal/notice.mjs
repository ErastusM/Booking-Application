// "Who we are" / legal notice: the supplier information online businesses must
// publish (Electronic Transactions Act 4 of 2019, consumer-protection part), shown
// at /legal in both apps and linked from the footer, the Privacy Policy and the
// Terms. The details themselves come from company.mjs.
import { COMPANY, operatorName, companyValue, companyPhones, telHref } from './company.mjs';
import { FEATURES } from '../features.mjs';

export const NOTICE_LAST_UPDATED = '26 September 2026';

export const legalNotice = (audience = 'customer') => {
    const op = operatorName(COMPANY);
    // companyValue: a missing or placeholder value is left out, never shown.
    const email = companyValue('email');
    const privacyEmail = companyValue('privacyEmail') || email;
    const phones = companyPhones();
    return {
        title: 'Who we are',
        updated: NOTICE_LAST_UPDATED,
        intro: [
            `Bookplus is an online booking marketplace${audience === 'business' ? ' and business app' : ''} operated by **${op}**.`,
        ],
        sections: [
            { id: 'company', title: 'Company details', blocks: [{ company: true }] },
            { id: 'contact', title: 'Contact us', blocks: [
                { list: [
                    ...(email ? [`Email: [${email}](mailto:${email})`] : []),
                    ...phones.map((p) => `Phone: [${p}](${telHref(p)})`),
                    ...(privacyEmail ? [`Privacy requests: [${privacyEmail}](mailto:${privacyEmail})`] : []),
                ] },
                'We aim to reply within 5 working days.',
            ] },
            { id: 'what-we-do', title: 'What Bookplus does', blocks: [
                `Bookplus lets clients find local businesses, see their prices and availability, book appointments, ${FEATURES.walletEnabled ? 'keep a prepaid wallet with a business, ' : ''}and message it. **The businesses provide the services; Bookplus does not.** Businesses list themselves; we do not vet, license or certify them. Reviews can only be left by clients who completed a booking.`,
                `Bookplus does not charge clients a booking fee. Prices are set by each business, in the currency it chooses, and shown before you book.${FEATURES.walletEnabled ? '' : ' You pay the business at your appointment; the wallet is coming soon.'}`,
            ] },
            { id: 'legal-documents', title: 'Terms, privacy and complaints', blocks: [
                { list: [
                    `[${audience === 'business' ? 'Business Terms of Service' : 'Terms of Service'}](/terms): how bookings, cancellations${FEATURES.walletEnabled ? ', wallets' : ''} and reviews work, and how to raise a complaint.`,
                    `[Privacy Policy](/privacy-policy): what we collect, why, who receives it and your rights.`,
                ] },
                'These documents can be saved or printed from their pages. Bookings are confirmed by email.',
            ] },
        ],
    };
};

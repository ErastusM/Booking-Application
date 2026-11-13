// "Who we are" / legal notice: the supplier information online businesses must
// publish (Electronic Transactions Act 4 of 2019, consumer-protection part), shown
// at /legal in both apps and linked from the footer, the Privacy Policy and the
// Terms. The details themselves come from company.mjs.
import { COMPANY, operatorName, companyValue, companyPhones, telHref } from './company.mjs';
import { FEATURES } from '../features.mjs';

export const NOTICE_LAST_UPDATED = '27 September 2026';

// `features` defaults to the shared switches; tests pass { walletEnabled: true }
// or { subscriptionBillingEnabled: true } to check what is shown once they are on.
export const legalNotice = (audience = 'customer', features = FEATURES) => {
    const W = !!features.walletEnabled;
    // Card payments for Bookplus plans: shown to business owners only.
    const S = audience === 'business' && !!features.subscriptionBillingEnabled;
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
                `Bookplus lets clients find local businesses, see their prices and availability, book appointments, ${W ? 'keep a prepaid wallet with a business, ' : ''}and message it. **The businesses provide the services; Bookplus does not.** Businesses list themselves; we do not vet, license or certify them. Reviews can only be left by clients who completed a booking.`,
                `Bookplus does not charge clients a booking fee. Prices are set by each business, in the currency it chooses, and shown before you book.${W ? '' : ' You pay the business at your appointment.'}`,
            ] },
            ...(S ? [{ id: 'plan-payments', title: 'Paying for your Bookplus plan', blocks: [
                { list: [
                    `Businesses pay **${op}** a monthly subscription for Bookplus, by card. The prices are shown in Account, Your plan before you add a card.`,
                    'Payments are processed by **PayGate** on its own secure page, with your bank’s 3D Secure check. PayGate saves your card for the monthly payments; Bookplus never sees or stores your card number.',
                    'Plan payments are charged in **Namibian Dollars (N$)**. Bookplus is based in **Namibia**.',
                    'Monthly payments, cancelling and refunds: see [Business Terms of Service](/terms#plan). You can cancel at any time.',
                    'Delivery: nothing is shipped. Bookplus is software you use online, available as soon as your plan starts.',
                ] },
            ] }] : []),
            { id: 'legal-documents', title: 'Terms, privacy and complaints', blocks: [
                { list: [
                    `[${audience === 'business' ? 'Business Terms of Service' : 'Terms of Service'}](/terms): how bookings, cancellations${W ? ', wallets' : ''}${S ? ', your plan and its payments' : ''} and reviews work, and how to raise a complaint.`,
                    `[Privacy Policy](/privacy-policy): what we collect, why, who receives it and your rights.`,
                ] },
                'These documents can be saved or printed from their pages. Bookings are confirmed by email.',
            ] },
        ],
    };
};

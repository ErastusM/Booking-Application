import React from 'react';
import { termsOfService } from '@bookplus/config/legal/terms.mjs';
import LegalPage from '../legal/LegalPage';

// Text: packages/config/legal/terms.mjs (shared with the business app).
const doc = termsOfService('customer');

const TermsOfService = () => (
    <LegalPage doc={doc} path="/terms" description="The terms for booking with businesses on Bookplus: prices, cancellations, the prepaid wallet, reviews and your rights." />
);

export default TermsOfService;

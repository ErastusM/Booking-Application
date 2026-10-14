import React from 'react';
import { termsOfService } from '@bookplus/config/legal/terms.mjs';
import LegalPage from '../legal/LegalPage';
import { LEGAL_FEATURES } from '../utils/payOnline';

// Text: packages/config/legal/terms.mjs (shared with the business app).
const doc = termsOfService('customer', LEGAL_FEATURES);

const TermsOfService = () => (
    <LegalPage doc={doc} path="/terms" description="The terms for booking with businesses on Bookplus: prices, cancellations, reviews and your rights." />
);

export default TermsOfService;

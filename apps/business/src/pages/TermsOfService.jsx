import React from 'react';
import { termsOfService } from '@bookplus/config/legal/terms.mjs';
import LegalPage from '../legal/LegalPage';
import { FEATURES } from '@bookplus/config/features.mjs';

// The provider-facing agreement (packages/config/legal/terms.mjs, 'business'):
// a business's obligations — listings, client data, wallets, taxes — differ from
// a client's, so the marketplace copy isn't the right agreement here.
const doc = termsOfService('business', FEATURES);

const TermsOfService = () => <LegalPage doc={doc} path="/terms" />;

export default TermsOfService;

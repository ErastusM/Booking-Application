import React from 'react';
import { privacyPolicy } from '@bookplus/config/legal/privacy.mjs';
import LegalPage from '../legal/LegalPage';

// Business-audience version of the shared policy (packages/config/legal/privacy.mjs):
// covers business owners and their team; for their own clients' information the
// business is an independent controller (see the Business Terms).
const doc = privacyPolicy('business');

const PrivacyPolicy = () => <LegalPage doc={doc} path="/privacy-policy" />;

export default PrivacyPolicy;

import React from 'react';
import { privacyPolicy } from '@bookplus/config/legal/privacy.mjs';
import LegalPage from '../legal/LegalPage';
import cookieList from '../legal/cookies.json';

// Business-audience version of the shared policy (packages/config/legal/privacy.mjs):
// covers business owners and their team; for their own clients' information the
// business is an independent controller (see the Business Terms).
// The cookie table comes from this app's cookies.json (same list as the banner).
const doc = privacyPolicy('business', undefined, cookieList);

const PrivacyPolicy = () => <LegalPage doc={doc} path="/privacy-policy" />;

export default PrivacyPolicy;

import React from 'react';
import { privacyPolicy } from '@bookplus/config/legal/privacy.mjs';
import LegalPage from '../legal/LegalPage';
import cookieList from '../legal/cookies.json';

// Text: packages/config/legal/privacy.mjs (shared with the business app).
// The cookie table comes from this app's cookies.json (same list as the banner).
const doc = privacyPolicy('customer', undefined, cookieList);

const PrivacyPolicy = () => (
    <LegalPage doc={doc} path="/privacy-policy" description="What Bookplus collects, why, who receives it, how long we keep it and your rights." />
);

export default PrivacyPolicy;

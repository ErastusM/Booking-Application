import React from 'react';
import { privacyPolicy } from '@bookplus/config/legal/privacy.mjs';
import LegalPage from '../legal/LegalPage';

// Text: packages/config/legal/privacy.mjs (shared with the business app).
const doc = privacyPolicy('customer');

const PrivacyPolicy = () => (
    <LegalPage doc={doc} path="/privacy-policy" description="What Bookplus collects, why, who receives it, how long we keep it and your rights." />
);

export default PrivacyPolicy;

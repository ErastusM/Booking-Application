import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LegalDocument } from '@bookplus/ui';
import { COMPANY } from '@bookplus/config/legal/company.mjs';
import Seo from '../components/Seo';

// Shared shell for the legal pages. The text itself lives in
// packages/config/legal (one source for both apps); this only adds the page
// frame, router links and SEO.
const renderLink = (href, children, key) => (
    <Link key={key} to={href} style={{ color: 'var(--gold-dark)', textDecoration: 'underline', textUnderlineOffset: '2px' }}>{children}</Link>
);

const RELATED = [
    ['/terms', 'Terms of Service'],
    ['/privacy-policy', 'Privacy Policy'],
    ['/legal', 'Who we are'],
];

const LegalPage = ({ doc, path, description }) => {
    const { hash } = useLocation();
    // Deep links such as /terms#wallet: the section renders after the lazy route
    // loads, so scroll to it once it exists.
    useEffect(() => {
        if (!hash) return;
        const el = document.getElementById(decodeURIComponent(hash.slice(1)));
        if (el) el.scrollIntoView();
    }, [hash]);

    return (
        <div className="container" style={{ paddingTop: 'clamp(4rem, 8vw, 7rem)', paddingBottom: '4rem', maxWidth: '820px' }}>
            <Seo
                title={`${doc.title} | Bookplus`}
                description={description}
                url={(typeof window !== 'undefined' ? window.location.origin : 'https://www.bookplus.pro') + path}
            />
            <LegalDocument
                doc={doc}
                company={COMPANY}
                renderLink={renderLink}
                related={RELATED.filter(([to]) => to !== path).map(([to, label]) => (
                    <Link key={to} to={to} style={{ color: 'var(--gold-dark)', fontWeight: 600 }}>{label}</Link>
                ))}
            />
        </div>
    );
};

export default LegalPage;

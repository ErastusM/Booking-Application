import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LegalDocument } from '@bookplus/ui';
import { COMPANY } from '@bookplus/config/legal/company.mjs';

// Shared shell for the business app's legal pages. The text lives in
// packages/config/legal (one source for both apps); this adds the page frame,
// router links and the tab title.
const renderLink = (href, children, key) => (
    <Link key={key} to={href} style={{ color: 'var(--gold-dark)', textDecoration: 'underline', textUnderlineOffset: '2px' }}>{children}</Link>
);

const RELATED = [
    ['/terms', 'Business Terms'],
    ['/privacy-policy', 'Privacy Policy'],
    ['/legal', 'Who we are'],
];

const LegalPage = ({ doc, path }) => {
    const { hash } = useLocation();
    useEffect(() => {
        const prev = document.title;
        document.title = `${doc.title} | Bookplus for Business`;
        return () => { document.title = prev; };
    }, [doc.title]);
    useEffect(() => {
        if (!hash) return;
        const el = document.getElementById(decodeURIComponent(hash.slice(1)));
        if (el) el.scrollIntoView();
    }, [hash]);

    return (
        <div className="container" style={{ paddingTop: 'clamp(4rem, 8vw, 7rem)', paddingBottom: '4rem', maxWidth: '820px' }}>
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

import React, { Fragment } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// Renders the structured legal documents (Privacy Policy, Terms, legal notice)
// that live in @bookplus/config/legal, so both apps show the same text from one
// source. Styled only with design-token variables; headings use --font-display.
//
// Text format:
//   a string                      -> paragraph with **bold** and [text](href)
//   { list: string[] }            -> bulleted list
//   { table: { head, rows } }     -> table on wide screens, stacked cards on phones
//   { note: string }              -> highlighted summary box
//   { company: true }             -> <CompanyDetails> for the operator

export type LegalBlock =
    | string
    | { list: string[] }
    | { table: { head: string[]; rows: string[][] } }
    | { note: string }
    | { company: true };

export interface LegalSection { id: string; title: string; blocks: LegalBlock[] }
export interface LegalDoc { title: string; updated?: string; intro?: LegalBlock[]; sections: LegalSection[] }

/** How an internal path ("/terms") becomes a link — pass the router's <Link>. */
export type RenderLink = (href: string, children: ReactNode, key: string) => ReactNode;

export interface CompanyInfo {
    tradingName?: string;
    legalName?: string;
    entityType?: string;
    registrationNumber?: string;
    registrationAuthority?: string;
    registeredOffice?: string;
    postalAddress?: string;
    phone?: string;
    email?: string;
    privacyContact?: string;
    privacyEmail?: string;
}

const linkStyle: CSSProperties = { color: 'var(--gold-dark)', textDecoration: 'underline', textUnderlineOffset: '2px' };
const para: CSSProperties = { color: 'var(--text-secondary)', lineHeight: 1.75, fontSize: '0.95rem', margin: '0 0 0.85rem' };
const liStyle: CSSProperties = { color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '0.95rem', marginBottom: '0.4rem' };
const h2Style: CSSProperties = { fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 600, color: 'var(--charcoal)', margin: '2.25rem 0 0.7rem', scrollMarginTop: '90px' };

/** Empty, or a "[Bracketed placeholder]" — never shown to users. */
export const isLegalPlaceholder = (v: unknown): boolean => v == null || String(v).trim() === '' || /\[[^\]]*\]/.test(String(v));

const defaultRenderLink: RenderLink = (href, children, key) => <a key={key} href={href} style={linkStyle}>{children}</a>;

/** Inline markup: **bold** and [text](href). Anything else is plain text. */
export const LegalText = ({ text, renderLink = defaultRenderLink }: { text: string; renderLink?: RenderLink }) => {
    const out: ReactNode[] = [];
    const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(text))) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const key = `t${i++}`;
        if (m[1] !== undefined) {
            out.push(<strong key={key} style={{ color: 'var(--charcoal)', fontWeight: 600 }}><LegalText text={m[1]} renderLink={renderLink} /></strong>);
        } else {
            const href = m[3];
            const external = /^(https?:|mailto:|tel:)/.test(href);
            out.push(external
                ? <a key={key} href={href} style={linkStyle} {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{m[2]}</a>
                : renderLink(href, m[2], key));
        }
        last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return <>{out}</>;
};

// Rows in display order. Placeholder values are skipped; see CompanyDetails.
const COMPANY_ROWS: Array<[keyof CompanyInfo, string]> = [
    ['legalName', 'Legal name'],
    ['tradingName', 'Trading as'],
    ['entityType', 'Type of entity'],
    ['registrationNumber', 'Registration number'],
    ['registrationAuthority', 'Registered with'],
    ['registeredOffice', 'Registered office'],
    ['postalAddress', 'Postal address'],
    ['phone', 'Phone'],
    ['email', 'Email'],
    ['privacyContact', 'Privacy contact'],
    ['privacyEmail', 'Privacy requests'],
];
const REQUIRED: Array<keyof CompanyInfo> = ['legalName', 'registrationNumber', 'registeredOffice', 'phone', 'email', 'privacyContact'];

/**
 * The operator's identity as a definition list. A value that is still a
 * placeholder is never shown; if any required value is missing, a
 * "details coming soon" line takes its place so users never see "[...]".
 */
export const CompanyDetails = ({ company }: { company: CompanyInfo }) => {
    const rows = COMPANY_ROWS.filter(([k]) => !isLegalPlaceholder(company[k]));
    const incomplete = REQUIRED.some((k) => isLegalPlaceholder(company[k]));
    const hrefFor = (k: keyof CompanyInfo, v: string) =>
        (k === 'email' || k === 'privacyEmail') ? `mailto:${v}` : k === 'phone' ? `tel:${v.replace(/[^+\d]/g, '')}` : null;
    return (
        <div data-testid="company-details" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1rem 1.15rem', margin: '0 0 1rem' }}>
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)', gap: '0.45rem 1rem' }}>
                {rows.map(([k, label]) => {
                    const v = String(company[k]).trim();
                    const href = hrefFor(k, v);
                    return (
                        <Fragment key={k}>
                            <dt style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{label}</dt>
                            <dd style={{ margin: 0, color: 'var(--charcoal)', fontSize: '0.9rem', fontWeight: 500, overflowWrap: 'anywhere' }}>
                                {href ? <a href={href} style={linkStyle}>{v}</a> : v}
                            </dd>
                        </Fragment>
                    );
                })}
            </dl>
            {incomplete && (
                <p data-testid="company-details-pending" style={{ ...para, margin: rows.length ? '0.75rem 0 0' : 0, fontSize: '0.88rem' }}>
                    Further company details coming soon.
                    {isLegalPlaceholder(company.email) ? null : <> Meanwhile, contact us at <a href={`mailto:${company.email}`} style={linkStyle}>{company.email}</a>.</>}
                </p>
            )}
        </div>
    );
};

const Table = ({ head, rows, renderLink }: { head: string[]; rows: string[][]; renderLink?: RenderLink }) => (
    <div className="bp-legal-table" style={{ margin: '0 0 1rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
                <tr>{head.map((h) => <th key={h} scope="col" style={{ textAlign: 'left', padding: '0.55rem 0.6rem', borderBottom: '2px solid var(--border)', color: 'var(--charcoal)', fontWeight: 600, verticalAlign: 'bottom' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
                {rows.map((r, ri) => (
                    <tr key={ri}>
                        {r.map((cell, ci) => (
                            <td key={ci} data-label={head[ci]} style={{ padding: '0.55rem 0.6rem', borderBottom: '1px solid var(--border)', color: ci === 0 ? 'var(--charcoal)' : 'var(--text-secondary)', fontWeight: ci === 0 ? 600 : 400, verticalAlign: 'top', lineHeight: 1.55 }}>
                                <LegalText text={cell} renderLink={renderLink} />
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

// Phones: each table row becomes a card with "Label: value" lines.
const TABLE_CSS = `
@media (max-width: 640px) {
  .bp-legal-table table, .bp-legal-table tbody, .bp-legal-table tr, .bp-legal-table td { display: block; width: 100%; }
  .bp-legal-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .bp-legal-table tr { border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 0.6rem; padding: 0.35rem 0.25rem; background: var(--card-bg); }
  .bp-legal-table td { border-bottom: none !important; padding: 0.3rem 0.6rem !important; }
  .bp-legal-table td:not(:first-child)::before { content: attr(data-label) ": "; font-weight: 600; color: var(--text-muted); }
}`;

const Block = ({ block, company, renderLink }: { block: LegalBlock; company?: CompanyInfo; renderLink?: RenderLink }) => {
    if (typeof block === 'string') return <p style={para}><LegalText text={block} renderLink={renderLink} /></p>;
    if ('list' in block) return <ul style={{ margin: '0 0 1rem', paddingLeft: '1.25rem' }}>{block.list.map((t, i) => <li key={i} style={liStyle}><LegalText text={t} renderLink={renderLink} /></li>)}</ul>;
    if ('table' in block) return <Table head={block.table.head} rows={block.table.rows} renderLink={renderLink} />;
    if ('note' in block) return <p style={{ ...para, background: 'var(--warm-gray)', borderRadius: 'var(--radius-sm)', padding: '0.85rem 1rem', color: 'var(--charcoal)' }}><LegalText text={block.note} renderLink={renderLink} /></p>;
    if ('company' in block) return company ? <CompanyDetails company={company} /> : null;
    return null;
};

export interface LegalDocumentProps {
    doc: LegalDoc;
    company?: CompanyInfo;
    renderLink?: RenderLink;
    /** Links shown under the title, e.g. to the other legal pages. */
    related?: ReactNode;
    /** Show a numbered contents list (default true). */
    contents?: boolean;
}

/** A full legal page: title, date, contents, numbered sections. */
export const LegalDocument = ({ doc, company, renderLink, related, contents = true }: LegalDocumentProps) => (
    <article data-testid="legal-document" style={{ fontFamily: 'var(--font-body)' }}>
        <style>{TABLE_CSS}</style>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.8rem, 6vw, 2.2rem)', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.4rem', lineHeight: 1.15 }}>{doc.title}</h1>
        {doc.updated && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 1rem' }}>Last updated: {doc.updated}</p>}
        {related && <nav aria-label="Legal pages" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1rem', margin: '0 0 1.25rem', fontSize: '0.88rem' }}>{related}</nav>}
        {(doc.intro || []).map((b, i) => <Block key={i} block={b} company={company} renderLink={renderLink} />)}
        {contents && doc.sections.length > 3 && (
            <nav aria-label="Contents" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.9rem 1.1rem', margin: '0 0 0.5rem' }}>
                <p style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.4rem', fontSize: '0.95rem' }}>Contents</p>
                <ol style={{ margin: 0, paddingLeft: '1.3rem', columns: '14rem', columnGap: '1.5rem' }}>
                    {doc.sections.map((s) => <li key={s.id} style={{ fontSize: '0.88rem', lineHeight: 1.7, breakInside: 'avoid' }}><a href={`#${s.id}`} style={{ color: 'var(--text-secondary)' }}>{s.title}</a></li>)}
                </ol>
            </nav>
        )}
        {doc.sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
                <h2 id={`${s.id}-h`} style={h2Style}>{i + 1}. {s.title}</h2>
                {s.blocks.map((b, j) => <Block key={j} block={b} company={company} renderLink={renderLink} />)}
            </section>
        ))}
    </article>
);

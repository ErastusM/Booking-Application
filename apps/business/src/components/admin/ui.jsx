import React from 'react';

// Building blocks for the admin console's pages (styles/admin.css), and the
// inline styles the Money views share, so the whole console looks the same.

/** Page heading row: optional crumb, title, actions on the right. */
export const PageHead = ({ title, crumb, children }) => (
    <div className="adm-head">
        <div>
            {crumb && <div className="adm-crumb">{crumb}</div>}
            <h1>{title}</h1>
        </div>
        {children && <div className="adm-tools">{children}</div>}
    </div>
);

/** A bordered panel, with an optional heading row (title + right-hand slot). */
export const Panel = ({ title, aside, children, body = false, className = '', ...rest }) => (
    <section className={`adm-panel ${className}`.trim()} {...rest}>
        {(title || aside) && (
            <div className="adm-panel-head">
                {title ? <h2>{title}</h2> : <span />}
                {aside}
            </div>
        )}
        {body ? <div className="adm-panel-body">{children}</div> : children}
    </section>
);

/** One strip of figures: [{ label, value, sub, tone, testid }]. */
export const Kpis = ({ items, ...rest }) => (
    <div className="adm-kpis" style={{ '--adm-kpi-n': items.length }} {...rest}>
        {items.map((k) => (
            <div className="adm-kpi" key={k.label} data-testid={k.testid}>
                <div className="adm-kpi-label">{k.label}</div>
                <div className="adm-kpi-value" data-tone={k.tone}>{k.value}</div>
                {k.sub && <div className="adm-kpi-sub">{k.sub}</div>}
            </div>
        ))}
    </div>
);

/** Choices where one is on: options [[value, label]]. Buttons with aria-pressed. */
export const Seg = ({ options, value, onChange, label }) => (
    <div className="adm-seg" role="group" aria-label={label}>
        {options.map(([v, text]) => (
            <button key={v || 'all'} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>
        ))}
    </div>
);

/** A status in words with a coloured dot. tone: ok | warn | bad | info | (muted). */
export const Status = ({ tone, children }) => <span className="adm-status" data-tone={tone}>{children}</span>;

export const Empty = ({ children }) => <div className="adm-panel-empty">{children}</div>;

/* Inline styles for the Money views (they predate the console's classes). */
export const panel = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', minWidth: 0 };
export const h2 = { fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.35rem' };
export const h3 = { fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.6rem' };
export const muted = { color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.55, margin: 0 };
export const input = {
    width: '100%', padding: '0.5rem 0.65rem', border: '1px solid var(--border-input)', borderRadius: '6px',
    fontFamily: 'var(--font-body)', fontSize: '0.86rem', color: 'var(--text-primary)', background: 'var(--input-bg)', boxSizing: 'border-box',
};
export const label = { display: 'block', fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.25rem' };
export const errBox = { background: 'var(--danger-bg)', color: 'var(--danger-fg)', padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem' };
export const th = { padding: '0.55rem 0.8rem', textAlign: 'left', fontSize: '0.76rem', fontWeight: 500, color: 'var(--text-muted)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' };
export const td = { padding: '0.55rem 0.8rem', fontSize: '0.84rem', borderTop: '1px solid var(--border)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
export const small = { padding: '0.3rem 0.65rem', fontSize: '0.78rem' };
export const list = { display: 'grid', gap: '12px', gridTemplateColumns: 'minmax(0, 1fr)' };
export const bad = 'var(--danger-fg)';

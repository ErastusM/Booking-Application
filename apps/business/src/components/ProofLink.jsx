import React, { useState } from 'react';

// "View proof" for a top-up. Proofs of payment are private Cloudinary assets:
// there is no link to render up front. On tap the API checks the viewer is the
// payer or the business owner (or, for a business top-up, Bookplus) and mints a
// signed link that works for a few minutes. The tab is opened synchronously
// (so pop-up blockers allow it) and pointed at the link once it arrives.
const ProofLink = ({ fetchLink, label = 'View proof' }) => {
    const [state, setState] = useState(''); // '' | 'loading' | error message
    const open = async (e) => {
        e.preventDefault();
        const win = window.open('about:blank', '_blank');
        if (win) win.opener = null;
        setState('loading');
        try {
            const res = await fetchLink();
            const url = res?.data?.data?.url;
            if (!url) throw new Error('none');
            if (win) win.location.href = url; else window.location.href = url;
            setState('');
        } catch (err) {
            if (win) win.close();
            setState(err?.response?.status === 404
                ? 'Only the client and the business owner can open this proof.'
                : 'Could not open the proof — try again.');
        }
    };
    return (
        <>
            <a href="#proof" onClick={open} style={{ color: 'var(--gold-dark)' }}>{state === 'loading' ? 'Opening…' : label}</a>
            {state && state !== 'loading' && <span role="alert" style={{ marginLeft: '0.35rem', color: 'var(--danger, #b91c1c)' }}>{state}</span>}
        </>
    );
};

export default ProofLink;

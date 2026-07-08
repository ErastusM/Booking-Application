import React, { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { providerMarketService } from '../services';
import ProviderProfilePage from './ProviderProfilePage';

// Public booking link — www.bookplus.pro/b/<slug>. Resolves the handle to the
// business's id, then renders the same profile page as /providers/:id so the
// link opens the business directly (never the home page or a search).
const ProviderProfileBySlug = () => {
    const { slug } = useParams();
    const [id, setId] = useState(null);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        let alive = true;
        providerMarketService.getProviderBySlug(slug)
            .then((r) => { if (alive) setId(r.data.data.provider._id); })
            .catch(() => { if (alive) setNotFound(true); });
        return () => { alive = false; };
    }, [slug]);

    if (notFound) return <Navigate to="/services" replace />;

    if (!id) {
        return (
            <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: '36px', height: '36px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            </div>
        );
    }

    return <ProviderProfilePage providerId={id} />;
};

export default ProviderProfileBySlug;

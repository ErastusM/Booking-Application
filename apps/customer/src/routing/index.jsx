// Routing adapter — Ionic migration Phase 2 (#70).
//
// Every navigation call in the app goes through THIS module instead of importing
// react-router-dom directly, so the eventual v6 -> v5 (Ionic react-router) swap in
// Phase 3 is a one-file change here rather than a sweep across ~20 call sites.
// Today these are thin pass-throughs over react-router v6 — behavior is identical.
import { useCallback } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';

// useNav() -> imperative navigate function. Accepts a path string with optional
// { replace, state }, or a number for history-relative navigation (e.g. -1).
// Mirrors v6's navigate() signature; in Phase 3 it re-points to v5's useHistory()
// (push / replace / go) without touching a single call site.
export function useNav() {
    const navigate = useNavigate();
    return useCallback((to, opts) => {
        if (typeof to === 'number') return navigate(to);
        return navigate(to, opts);
    }, [navigate]);
}

// useQueryParams() -> a read-only URLSearchParams for the current location.
// (No call site writes query params.) In Phase 3 this becomes
// `new URLSearchParams(useLocation().search)`; `.get()` is identical.
export function useQueryParams() {
    const [searchParams] = useSearchParams();
    return searchParams;
}

// <AppRedirect to=".." replace /> -> declarative redirect. Wraps v6 <Navigate>;
// becomes v5 <Redirect> in Phase 3 with the same { to, replace } contract.
export function AppRedirect({ to, replace = true, state }) {
    return <Navigate to={to} replace={replace} state={state} />;
}

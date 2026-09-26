import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const svc = vi.hoisted(() => ({
    getStaffInvite: vi.fn(),
    acceptStaffInvite: vi.fn(),
    renewStaffInvite: vi.fn(),
    requestStaffInvite: vi.fn(),
}));
const auth = vi.hoisted(() => ({ login: vi.fn(), refreshProfile: vi.fn(), deviceSession: null }));
vi.mock('../services', () => ({ authService: svc }));
vi.mock('../context/AuthContext', () => ({ useAuthContext: () => auth }));

import AcceptInvite, { PREVIEW_BACKOFF_MS } from './AcceptInvite';

const Where = () => <div data-testid="where">{useLocation().pathname}</div>;
const renderAt = (url = '/accept-invite?token=RAW') => render(
    <MemoryRouter initialEntries={[url]}>
        <Routes>
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="*" element={<Where />} />
        </Routes>
    </MemoryRouter>,
);
const httpErr = (status, data = {}) => Object.assign(new Error(String(status)), { response: { status, data } });
const PREVIEW = { data: { data: { valid: true, name: 'John', email: 'john@x.test', businessName: 'Vido Cuts', returning: false } } };
const state = () => screen.getByTestId('invite-state').dataset.state;

beforeEach(() => {
    Object.values(svc).forEach((f) => f.mockReset());
    auth.login.mockReset(); auth.refreshProfile.mockReset().mockResolvedValue({});
    auth.deviceSession = null;
});
afterEach(() => vi.useRealTimers());

describe('AcceptInvite states', () => {
    it('checking shows a skeleton with no inputs, then the form', async () => {
        let resolve;
        svc.getStaffInvite.mockReturnValue(new Promise((r) => { resolve = r; }));
        renderAt();
        expect(state()).toBe('checking');
        expect(document.querySelectorAll('input').length).toBe(0);
        await act(async () => resolve(PREVIEW));
        expect(state()).toBe('valid');
        expect(screen.getByTestId('invite-title')).toHaveTextContent('You’re joining Vido Cuts');
        expect(screen.getByTestId('accept-rules')).toBeInTheDocument();
    });

    it.each([
        ['INVITE_EXPIRED', 'expired'], ['INVITE_SUPERSEDED', 'superseded'], ['INVITE_ACCEPTED', 'accepted'],
        ['INVITE_REVOKED', 'revoked'], ['INVITE_INVALID', 'invalid'], [undefined, 'invalid'],
    ])('404 %s → %s', async (code, st) => {
        svc.getStaffInvite.mockRejectedValue(httpErr(404, { code, newerSentAt: '2026-09-20T10:00:00Z', email: 'john@x.test' }));
        renderAt();
        await waitFor(() => expect(state()).toBe(st));
    });

    it('a missing token is "invalid" with an email box', () => {
        renderAt('/accept-invite');
        expect(state()).toBe('invalid');
        expect(screen.getByTestId('invite-new-link-email')).toBeInTheDocument();
    });

    it('transient failures are retried, then "couldn’t check" — never "expired"', async () => {
        vi.useFakeTimers();
        svc.getStaffInvite.mockRejectedValue(httpErr(503));
        renderAt();
        for (const ms of PREVIEW_BACKOFF_MS) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
        expect(svc.getStaffInvite).toHaveBeenCalledTimes(PREVIEW_BACKOFF_MS.length + 1);
        expect(state()).toBe('unreachable');
        expect(screen.queryByText(/expired/i)).toBeNull();
        svc.getStaffInvite.mockResolvedValue(PREVIEW);
        await act(async () => { fireEvent.click(screen.getByTestId('invite-retry')); });
        expect(state()).toBe('valid');
    });

    it('recovers inside the backoff without showing an error', async () => {
        vi.useFakeTimers();
        svc.getStaffInvite.mockRejectedValueOnce(new Error('Network Error')).mockRejectedValueOnce(httpErr(429)).mockResolvedValue(PREVIEW);
        renderAt();
        await act(async () => { await vi.advanceTimersByTimeAsync(PREVIEW_BACKOFF_MS[0] + PREVIEW_BACKOFF_MS[1]); });
        expect(state()).toBe('valid');
    });

    it('expired → "Email me a new link" → neutral confirmation', async () => {
        svc.getStaffInvite.mockRejectedValue(httpErr(404, { code: 'INVITE_EXPIRED' }));
        svc.renewStaffInvite.mockResolvedValue({ data: { success: true } });
        renderAt();
        await waitFor(() => expect(state()).toBe('expired'));
        fireEvent.click(screen.getByTestId('invite-new-link-button'));
        await screen.findByTestId('invite-new-link-sent');
        expect(svc.renewStaffInvite).toHaveBeenCalledWith('RAW');
        expect(screen.getByTestId('invite-signin-link')).toHaveTextContent('Already set a password? Sign in');
    });

    it('superseded names the newer invite date', async () => {
        svc.getStaffInvite.mockRejectedValue(httpErr(404, { code: 'INVITE_SUPERSEDED', newerSentAt: '2026-09-20T10:00:00Z' }));
        renderAt();
        await waitFor(() => expect(state()).toBe('superseded'));
        expect(screen.getByText(/A newer invite was sent on/)).toBeInTheDocument();
    });
});

describe('AcceptInvite submit', () => {
    const fill = (pw = 'Password1!', cf = pw) => {
        fireEvent.change(screen.getByTestId('accept-password'), { target: { value: pw } });
        fireEvent.change(screen.getByTestId('accept-confirm'), { target: { value: cf } });
        fireEvent.click(screen.getByTestId('accept-submit'));
    };

    it('success: login, refetch profile, replace to /dashboard', async () => {
        svc.getStaffInvite.mockResolvedValue(PREVIEW);
        const session = { token: 't', refreshToken: 'r', user: { role: 'staff', staffTier: 'basic' } };
        svc.acceptStaffInvite.mockResolvedValue({ data: { data: session } });
        renderAt();
        await waitFor(() => expect(state()).toBe('valid'));
        fill();
        await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/dashboard'));
        expect(auth.login).toHaveBeenCalledWith(session);
        expect(auth.refreshProfile).toHaveBeenCalled();
    });

    it('does not submit until the rules are met or when the confirmation differs', async () => {
        svc.getStaffInvite.mockResolvedValue(PREVIEW);
        renderAt();
        await waitFor(() => expect(state()).toBe('valid'));
        fill('password');
        expect(await screen.findByTestId('invite-error')).toBeInTheDocument();
        fill('Password1!', 'Password1?');
        expect(screen.getByTestId('invite-error')).toHaveTextContent(/don’t match/);
        expect(svc.acceptStaffInvite).not.toHaveBeenCalled();
    });

    it('a 400 with a code moves to that state (e.g. accepted elsewhere)', async () => {
        svc.getStaffInvite.mockResolvedValue(PREVIEW);
        svc.acceptStaffInvite.mockRejectedValue(httpErr(400, { code: 'INVITE_ACCEPTED', email: 'john@x.test' }));
        renderAt();
        await waitFor(() => expect(state()).toBe('valid'));
        fill();
        await waitFor(() => expect(state()).toBe('accepted'));
        expect(screen.getByTestId('invite-sign-in').getAttribute('href')).toBe('/login?email=john%40x.test');
    });

    it('warns when someone else is signed in on the device (without logging them out)', async () => {
        auth.deviceSession = { name: 'Owner Olivia', email: 'owner@x.test' };
        svc.getStaffInvite.mockResolvedValue(PREVIEW);
        renderAt();
        await waitFor(() => expect(state()).toBe('valid'));
        expect(screen.getByTestId('invite-device-session')).toHaveTextContent('signed in as Owner Olivia');
        expect(screen.getByTestId('invite-device-session')).toHaveTextContent('john@x.test');
    });
});

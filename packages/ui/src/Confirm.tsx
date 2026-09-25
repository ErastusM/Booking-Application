import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { canUseDOM, cx, lockBodyScroll, useEscapeLayer, useInjectStyles, Z_LAYER } from './internal/dom';
import { textOf } from './internal/text';

// App-styled replacements for window.confirm / window.alert, which draw the
// browser's own grey box (and on iOS, the site's domain as its title).
//
//   const confirm = useConfirm();
//   if (!(await confirm({ title: 'Delete this service?', danger: true, confirmLabel: 'Delete' }))) return;
//
// Requests queue, so two calls in a row show one dialog after the other.
// Outside a <ConfirmProvider> the hooks fall back to the native dialogs, so a
// component rendered alone (a unit test, a story) still works.

export interface ConfirmOptions {
    title?: ReactNode;
    /** Body text. Newlines are kept (white-space: pre-line). */
    message?: ReactNode;
    /** Default "Confirm". Say what happens: "Delete", "Mark no-show". */
    confirmLabel?: string;
    /** Default "Cancel". Use e.g. "Keep it" when the action itself is a cancel. */
    cancelLabel?: string;
    /** Red confirm button + title, and focus starts on the safe button. */
    danger?: boolean;
    /** Same as `danger: true` when 'danger'. */
    tone?: 'default' | 'danger';
    /** Test id on the dialog panel (default "confirm-dialog"). */
    testId?: string;
}

export interface AlertOptions {
    title?: ReactNode;
    message?: ReactNode;
    /** Default "OK". */
    okLabel?: string;
    tone?: 'default' | 'danger';
    testId?: string;
}

/** A string is shorthand: one line becomes the title, multi-line the message. */
export type ConfirmInput = ConfirmOptions | string;
export type AlertInput = AlertOptions | string;
export type ConfirmFn = (options: ConfirmInput) => Promise<boolean>;
export type AlertFn = (options: AlertInput) => Promise<void>;

type Request =
    | { id: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (ok: boolean) => void }
    | { id: number; kind: 'alert'; opts: AlertOptions; resolve: (ok: boolean) => void };

const fromString = <T extends { title?: ReactNode; message?: ReactNode }>(input: T | string): T =>
    (typeof input === 'string' ? (input.includes('\n') ? { message: input } : { title: input }) : input) as T;

const nativeText = (o: { title?: ReactNode; message?: ReactNode }) =>
    [textOf(o.title), textOf(o.message)].filter(Boolean).join('\n\n');

const nativeFallback = {
    confirm: (input: ConfirmInput) =>
        Promise.resolve(typeof window !== 'undefined' ? window.confirm(nativeText(fromString(input))) : false),
    alert: (input: AlertInput) => {
        if (typeof window !== 'undefined') window.alert(nativeText(fromString(input)));
        return Promise.resolve();
    },
};

const ConfirmContext = createContext<{ confirm: ConfirmFn; alert: AlertFn } | null>(null);

/** Resolves true when the user confirms, false on Cancel, Escape or a tap outside. */
export const useConfirm = (): ConfirmFn => (useContext(ConfirmContext) ?? nativeFallback).confirm;

/** Resolves once the user has dismissed it. */
export const useAlert = (): AlertFn => (useContext(ConfirmContext) ?? nativeFallback).alert;

export function ConfirmProvider({ children }: { children?: ReactNode }) {
    const [queue, setQueue] = useState<Request[]>([]);
    const nextId = useRef(0);

    const confirm = useCallback<ConfirmFn>((input) => new Promise<boolean>((resolve) => {
        nextId.current += 1;
        const req: Request = { id: nextId.current, kind: 'confirm', opts: fromString<ConfirmOptions>(input), resolve };
        setQueue((q) => [...q, req]);
    }), []);

    const alert = useCallback<AlertFn>((input) => new Promise<void>((resolve) => {
        nextId.current += 1;
        const req: Request = { id: nextId.current, kind: 'alert', opts: fromString<AlertOptions>(input), resolve: () => resolve() };
        setQueue((q) => [...q, req]);
    }), []);

    const api = useMemo(() => ({ confirm, alert }), [confirm, alert]);
    const current = queue[0];

    const finish = useCallback((req: Request, ok: boolean) => {
        setQueue((q) => q.filter((r) => r !== req));
        req.resolve(ok);
    }, []);

    return (
        <ConfirmContext.Provider value={api}>
            {children}
            {current ? <ConfirmDialog key={current.id} request={current} onDone={finish} /> : null}
        </ConfirmContext.Provider>
    );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ConfirmDialog({ request, onDone }: { request: Request; onDone: (req: Request, ok: boolean) => void }) {
    useInjectStyles();
    const baseId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    const okRef = useRef<HTMLButtonElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const settled = useRef(false);

    const isConfirm = request.kind === 'confirm';
    const opts = request.opts;
    const danger = (isConfirm && (request.opts as ConfirmOptions).danger) || opts.tone === 'danger';
    const confirmLabel = isConfirm ? (request.opts as ConfirmOptions).confirmLabel || 'Confirm' : (request.opts as AlertOptions).okLabel || 'OK';
    const cancelLabel = isConfirm ? (request.opts as ConfirmOptions).cancelLabel || 'Cancel' : '';

    const done = (ok: boolean) => {
        if (settled.current) return;
        settled.current = true;
        onDone(request, ok);
    };
    // Escape, and a tap on the backdrop, mean "no" (an alert just closes).
    const dismiss = () => done(!isConfirm);

    useEscapeLayer(true, dismiss);

    useEffect(() => {
        const previous = canUseDOM ? (document.activeElement as HTMLElement | null) : null;
        const release = lockBodyScroll();
        // Destructive: start on the safe button, so a stray Enter doesn't delete.
        (danger && cancelRef.current ? cancelRef.current : okRef.current)?.focus({ preventScroll: true });
        return () => {
            release();
            if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keep Tab inside the dialog.
    const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Tab' || !panelRef.current) return;
        const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const at = document.activeElement;
        if (e.shiftKey && (at === first || !panelRef.current.contains(at))) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && (at === last || !panelRef.current.contains(at))) {
            e.preventDefault();
            first.focus();
        }
    };

    if (!canUseDOM) return null;

    const titleId = `${baseId}-title`;
    const msgId = `${baseId}-msg`;
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    return createPortal(
        <div className="bp-layer" onClick={stop} onMouseDown={stop} onPointerDown={stop} onTouchStart={stop} onKeyDown={stop}>
            <div className="bp-scrim" style={{ zIndex: Z_LAYER }} aria-hidden="true" />
            <div
                className="bp-dialog-wrap"
                style={{ zIndex: Z_LAYER }}
                onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
            >
                <div
                    ref={panelRef}
                    className="bp-dialog"
                    role={isConfirm ? 'alertdialog' : 'dialog'}
                    aria-modal="true"
                    aria-labelledby={opts.title ? titleId : undefined}
                    aria-label={opts.title ? undefined : textOf(opts.message) || (isConfirm ? 'Confirm' : 'Notice')}
                    aria-describedby={opts.message ? msgId : undefined}
                    data-tone={danger ? 'danger' : undefined}
                    data-testid={opts.testId || 'confirm-dialog'}
                    tabIndex={-1}
                    onKeyDown={onKeyDown}
                >
                    {opts.title ? <h2 id={titleId} className="bp-dialog-title">{opts.title}</h2> : null}
                    {opts.message ? <div id={msgId} className="bp-dialog-msg">{opts.message}</div> : null}
                    <div className="bp-dialog-actions">
                        {isConfirm ? (
                            <button ref={cancelRef} type="button" className="btn-outline" data-testid="confirm-cancel" onClick={() => done(false)}>
                                {cancelLabel}
                            </button>
                        ) : null}
                        <button
                            ref={okRef}
                            type="button"
                            className={cx('btn-primary', danger && 'bp-danger')}
                            data-testid="confirm-ok"
                            onClick={() => done(true)}
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}

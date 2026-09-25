import React, { useEffect, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { canUseDOM, lockBodyScroll, useEscapeLayer, useIsoLayoutEffect, Z_LAYER } from './dom';

// The one surface every picker opens into.
//  • Narrow screens: a bottom sheet (card background, rounded top, drag handle,
//    safe-area padding, scrim; drag the handle down or tap the scrim to close).
//  • Wide screens: a popover anchored under (or above) the trigger.
// Both portal to document.body, so they escape the overflow/transform of the
// modal, side panel or table they are opened from, and stack at Z_LAYER.

export type DismissReason = 'outside' | 'escape' | 'drag' | 'blur';

type PanelProps = HTMLAttributes<HTMLDivElement> & { 'data-testid'?: string };

export interface PopupProps {
    open: boolean;
    sheet: boolean;
    anchorRef: RefObject<HTMLElement>;
    panelRef: RefObject<HTMLDivElement>;
    onDismiss: (reason: DismissReason) => void;
    /** Heading on the sheet (popovers don't show one). */
    title?: ReactNode;
    /** Popover width floor in px; a wider trigger wins. */
    minWidth?: number;
    /** Exact popover width in px (calendar, time columns). Overrides minWidth. */
    width?: number;
    /** Popover height ceiling in px. */
    maxHeight?: number;
    /** Fixed sheet height (e.g. '70dvh') so a filtered list doesn't make it jump. */
    sheetHeight?: string;
    panelProps?: PanelProps;
    children: ReactNode;
}

interface Placement {
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
}

const DRAG_CLOSE_PX = 80;

export function Popup({
    open, sheet, anchorRef, panelRef, onDismiss, title, minWidth = 200, width, maxHeight = 320,
    sheetHeight, panelProps, children,
}: PopupProps) {
    const dismissRef = useRef(onDismiss);
    dismissRef.current = onDismiss;

    const [place, setPlace] = useState<Placement | null>(null);
    const [dragY, setDragY] = useState(0);
    const drag = useRef<{ y: number } | null>(null);
    // Height the on-screen keyboard takes from the bottom (iOS keeps fixed
    // elements on the layout viewport, so a sheet would sit under the keyboard).
    const [keyboard, setKeyboard] = useState({ inset: 0, height: 0 });

    useEscapeLayer(open, () => dismissRef.current('escape'));

    // Popover placement: below the trigger when there's room (or more room than
    // above), otherwise above; clamped to the viewport; follows scroll/resize.
    useIsoLayoutEffect(() => {
        if (!open || sheet || !canUseDOM) return undefined;
        let raf = 0;
        const measure = () => {
            raf = 0;
            const anchor = anchorRef.current;
            if (!anchor) return;
            const r = anchor.getBoundingClientRect();
            const vw = window.innerWidth || document.documentElement.clientWidth;
            const vh = window.innerHeight || document.documentElement.clientHeight;
            const margin = 8;
            const gap = 6;
            const w = Math.min(width ?? Math.max(r.width, minWidth), vw - margin * 2);
            const left = Math.min(Math.max(r.left, margin), Math.max(margin, vw - w - margin));
            const below = vh - r.bottom - gap - margin;
            const above = r.top - gap - margin;
            if (below >= Math.min(maxHeight, 240) || below >= above) {
                setPlace({ top: r.bottom + gap, left, width: w, maxHeight: Math.max(160, Math.min(maxHeight, below)) });
            } else {
                setPlace({ bottom: vh - r.top + gap, left, width: w, maxHeight: Math.max(160, Math.min(maxHeight, above)) });
            }
        };
        measure();
        const schedule = (e?: Event) => {
            // Scrolling the popup's own list must not re-measure.
            if (e && e.target instanceof Node && panelRef.current?.contains(e.target)) return;
            if (!raf) raf = window.requestAnimationFrame(measure);
        };
        window.addEventListener('resize', schedule);
        window.addEventListener('scroll', schedule, true);
        return () => {
            window.removeEventListener('resize', schedule);
            window.removeEventListener('scroll', schedule, true);
            if (raf) window.cancelAnimationFrame(raf);
        };
    }, [open, sheet, width, minWidth, maxHeight]);

    // Popover: a press anywhere outside the panel and its trigger closes it and
    // lets the press through, like a native select. (The sheet has a scrim that
    // closes on click instead — closing on pointerdown there would let the
    // follow-up click land on whatever the scrim was covering.)
    // Either way, focus moving outside (Tab away) closes it too.
    useEffect(() => {
        if (!open || !canUseDOM) return undefined;
        const inside = (t: EventTarget | null) =>
            t instanceof Node && (!!panelRef.current?.contains(t) || !!anchorRef.current?.contains(t));
        const onDown = (e: Event) => {
            if (!sheet && !inside(e.target)) dismissRef.current('outside');
        };
        const onFocusIn = (e: FocusEvent) => {
            if (!inside(e.target)) dismissRef.current('blur');
        };
        document.addEventListener('pointerdown', onDown, true);
        document.addEventListener('focusin', onFocusIn, true);
        return () => {
            document.removeEventListener('pointerdown', onDown, true);
            document.removeEventListener('focusin', onFocusIn, true);
        };
    }, [open, sheet]);

    // Sheet only: lock page scroll and track the on-screen keyboard.
    useEffect(() => {
        if (!open || !sheet || !canUseDOM) return undefined;
        const release = lockBodyScroll();
        const vv = window.visualViewport;
        const update = () => {
            if (!vv) return;
            const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
            setKeyboard({ inset, height: vv.height });
        };
        update();
        vv?.addEventListener('resize', update);
        vv?.addEventListener('scroll', update);
        return () => {
            release();
            vv?.removeEventListener('resize', update);
            vv?.removeEventListener('scroll', update);
        };
    }, [open, sheet]);

    useEffect(() => {
        if (!open) setDragY(0);
    }, [open]);

    if (!open || !canUseDOM) return null;

    // Keep every press, click and key inside the popup from bubbling (through the
    // React tree) to whatever the picker sits in — a clickable table row, or a
    // modal scrim that closes on click.
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    let content: ReactNode;
    if (sheet) {
        const kbOpen = keyboard.inset > 0;
        const sheetStyle: CSSProperties = {
            zIndex: Z_LAYER,
            bottom: keyboard.inset,
            height: sheetHeight,
            maxHeight: kbOpen ? Math.round(keyboard.height * 0.92) : undefined,
            transform: dragY ? `translateY(${dragY}px)` : undefined,
            transition: drag.current ? 'none' : undefined,
        };
        content = (
            <>
                <div className="bp-scrim" style={{ zIndex: Z_LAYER }} aria-hidden="true" onClick={() => dismissRef.current('outside')} />
                <div {...panelProps} ref={panelRef} className="bp-sheet" style={{ ...sheetStyle, ...panelProps?.style }}>
                    <div
                        className="bp-sheet-grab"
                        onPointerDown={(e) => {
                            drag.current = { y: e.clientY };
                            e.currentTarget.setPointerCapture?.(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                            if (drag.current) setDragY(Math.max(0, e.clientY - drag.current.y));
                        }}
                        onPointerUp={(e) => {
                            if (!drag.current) return;
                            const dy = e.clientY - drag.current.y;
                            drag.current = null;
                            if (dy > DRAG_CLOSE_PX) dismissRef.current('drag');
                            else setDragY(0);
                        }}
                        onPointerCancel={() => {
                            drag.current = null;
                            setDragY(0);
                        }}
                    >
                        <div className="bp-handle" />
                        {title ? <div className="bp-sheet-title">{title}</div> : null}
                    </div>
                    {children}
                </div>
            </>
        );
    } else {
        const popStyle: CSSProperties = place
            ? { zIndex: Z_LAYER, top: place.top, bottom: place.bottom, left: place.left, width: place.width, maxHeight: place.maxHeight }
            // Before the first measurement (never painted: the layout effect above
            // runs first). Transparent rather than visibility:hidden so pickers can
            // already move focus into it.
            : { zIndex: Z_LAYER, top: 0, left: 0, opacity: 0, pointerEvents: 'none' };
        content = (
            <div {...panelProps} ref={panelRef} className="bp-pop" style={{ ...popStyle, ...panelProps?.style }}>
                {children}
            </div>
        );
    }

    return createPortal(
        <div
            className="bp-layer"
            onClick={stop}
            onMouseDown={stop}
            onPointerDown={stop}
            onTouchStart={stop}
            onKeyDown={stop}
        >
            {content}
        </div>,
        document.body,
    );
}

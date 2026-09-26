import React, { cloneElement, isValidElement, useId } from 'react';

// A labelled form field. WCAG 1.3.1 / 4.1.2: every control needs a label that is
// tied to it in code, not just drawn above it. Field makes that the default —
// it gives the control an id (useId, so two copies of a form never collide) and
// points the <label htmlFor> at it, and links any hint/error through
// aria-describedby. Works with native inputs, textareas and selects, and with
// the @bookplus/ui pickers (their trigger is a <button>, which a <label> can
// name too).
//
//   <Field label="Email address" labelStyle={labelStyle}>
//       <input type="email" name="email" className="input" … />
//   </Field>
//
// With no className/style, Field renders a fragment — the label and control stay
// exactly where they were in the DOM, so it drops into an existing flex/grid
// layout without moving anything. Pass className/style to get a wrapping <div>.

export interface FieldProps {
    /** Visible label text. */
    label: React.ReactNode;
    /** Exactly one form control. It keeps its own id if it has one. */
    children: React.ReactElement;
    /** Optional helper text under the control (announced as its description). */
    hint?: React.ReactNode;
    /** Error text; also sets aria-invalid on the control. */
    error?: React.ReactNode;
    /** Adds a visual "*" after the label (the control keeps its own `required`). */
    required?: boolean;
    /** Forces the control's id (otherwise its own id, else a generated one). */
    id?: string;
    className?: string;
    style?: React.CSSProperties;
    labelClassName?: string;
    labelStyle?: React.CSSProperties;
    hintStyle?: React.CSSProperties;
    errorStyle?: React.CSSProperties;
}

type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: unknown };

export function Field({
    label, children, hint, error, required, id, className, style,
    labelClassName, labelStyle, hintStyle, errorStyle,
}: FieldProps) {
    const auto = useId();
    const control = isValidElement<ControlProps>(children) ? children : null;
    const controlId = id || control?.props.id || `field${auto.replace(/:/g, '')}`;
    const hintId = hint ? `${controlId}-hint` : undefined;
    const errorId = error ? `${controlId}-error` : undefined;
    const describedBy = [control?.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;

    const Wrap = className || style ? 'div' : React.Fragment;
    const wrapProps = className || style ? { className, style } : {};
    return (
        <Wrap {...wrapProps}>
            <label htmlFor={controlId} className={labelClassName ?? (labelStyle ? undefined : 'field-label')} style={labelStyle}>
                {label}
                {required ? <span aria-hidden="true"> *</span> : null}
            </label>
            {control
                ? cloneElement(control, {
                    id: controlId,
                    'aria-describedby': describedBy,
                    ...(error ? { 'aria-invalid': true } : {}),
                })
                : children}
            {hint ? <div id={hintId} className="field-hint" style={hintStyle}>{hint}</div> : null}
            {error ? <div id={errorId} className="field-error" role="alert" style={errorStyle}>{error}</div> : null}
        </Wrap>
    );
}

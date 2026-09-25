import { Children, Fragment, isValidElement } from 'react';
import type { ReactNode } from 'react';

// Plain text of a React node: what a label reads as, for search, typeahead and
// the sheet title. `<>{name} — {email}</>` gives "name — email".
export function textOf(node: ReactNode): string {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (isValidElement(node)) {
        const props = node.props as { children?: ReactNode };
        return textOf(props.children);
    }
    return '';
}

export interface ParsedOption {
    value: string;
    label: ReactNode;
    disabled?: boolean;
    hidden?: boolean;
    group?: string;
}

// <option>/<optgroup> children -> option objects, so a native <select>'s body can
// be moved under <Select> unchanged. Mirrors the native rules: an <option>
// without a value attribute uses its text; <optgroup disabled> disables its
// options; fragments and arrays (from .map) are walked.
export function parseOptionChildren(children: ReactNode): ParsedOption[] {
    const out: ParsedOption[] = [];
    const walk = (nodes: ReactNode, group?: string, groupDisabled?: boolean) => {
        Children.forEach(nodes, (child) => {
            if (!isValidElement(child)) return;
            const props = child.props as {
                value?: string | number; children?: ReactNode; disabled?: boolean; hidden?: boolean; label?: string;
            };
            if (child.type === Fragment) {
                walk(props.children, group, groupDisabled);
            } else if (child.type === 'optgroup') {
                walk(props.children, props.label, !!props.disabled);
            } else if (child.type === 'option') {
                const text = textOf(props.children);
                out.push({
                    value: props.value !== undefined && props.value !== null ? String(props.value) : text,
                    label: text,
                    disabled: !!props.disabled || !!groupDisabled,
                    hidden: !!props.hidden,
                    group,
                });
            }
        });
    };
    walk(children);
    return out;
}

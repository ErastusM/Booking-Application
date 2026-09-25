// Minimal ambient types for the one react-dom API this package uses.
//
// react-dom is a peer dependency (the apps already ship it), but @types/react-dom
// is not installed in the workspace, and adding a devDependency means a lockfile
// + node_modules change for a single signature. This shim is enough for tsc;
// nothing in the emitted .d.ts files references react-dom, so consumers are
// unaffected. Delete it if @types/react-dom is ever added.
declare module 'react-dom' {
    import type { ReactNode, ReactPortal } from 'react';

    export function createPortal(
        children: ReactNode,
        container: Element | DocumentFragment,
        key?: null | string,
    ): ReactPortal;
}

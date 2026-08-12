import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Unmount between tests so a stray timer or listener from one test cannot
// affect the next — the drag machinery is full of both.
afterEach(cleanup);

// jsdom has no layout engine, so getBoundingClientRect returns all zeros and
// any code that measures elements silently sees a zero-sized world. Tests that
// depend on geometry must stub it explicitly rather than trusting this.

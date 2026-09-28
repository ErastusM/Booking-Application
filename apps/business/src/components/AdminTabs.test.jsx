import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AdminTabs from './AdminTabs';

const TABS = ['appointments', 'services', 'users', 'revenue', 'wallet'];

// jsdom has no layout: fake a 390px-wide row holding ~600px of tabs.
const fakeOverflow = (el, { scrollWidth = 600, clientWidth = 390, scrollLeft = 0 } = {}) => {
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
    el.scrollLeft = scrollLeft;
};

describe('AdminTabs', () => {
    it('renders every tab as a tab, the active one selected', () => {
        const onChange = vi.fn();
        render(<AdminTabs tabs={TABS} active="users" onChange={onChange} />);
        expect(screen.getAllByRole('tab')).toHaveLength(5);
        expect(screen.getByRole('tab', { name: 'Users' })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('tab', { name: 'Revenue' }));
        expect(onChange).toHaveBeenCalledWith('revenue');
    });

    it('shows a right-edge fade while more tabs are off-screen, and a left one once scrolled', () => {
        render(<AdminTabs tabs={TABS} active="appointments" onChange={() => {}} />);
        const row = screen.getByTestId('admin-tabs');
        fakeOverflow(row);
        fireEvent.scroll(row);
        expect(screen.getByTestId('admin-tabs-fade-right')).toBeInTheDocument();
        expect(screen.queryByTestId('admin-tabs-fade-left')).toBeNull();
        fakeOverflow(row, { scrollLeft: 210 });
        fireEvent.scroll(row);
        expect(screen.queryByTestId('admin-tabs-fade-right')).toBeNull();
        expect(screen.getByTestId('admin-tabs-fade-left')).toBeInTheDocument();
    });
});

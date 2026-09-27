import React from 'react';
import { X } from 'lucide-react';

// Clear (✕) button for a search field. Sits at the right edge of the input, so
// the parent must be position:relative and the input needs right padding
// (2.75rem) to keep its text from running underneath. The drawn circle is
// 32px; the button around it is 44px, a full-size target for the thumb.
const SearchClear = ({ onClear, label = 'Clear search' }) => (
    <button
        type="button"
        onClick={onClear}
        aria-label={label}
        title={label}
        style={{
            position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '44px', height: '44px', padding: 0, borderRadius: '50%',
            border: 'none', background: 'transparent', color: 'var(--text-secondary)',
            cursor: 'pointer', lineHeight: 1,
        }}
    >
        <span aria-hidden="true" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '2rem', height: '2rem', borderRadius: '50%', background: 'var(--surface-sunken)',
        }}>
            <X size={14} strokeWidth={2.5} />
        </span>
    </button>
);

export default SearchClear;

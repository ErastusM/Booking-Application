import React from 'react';
import { X } from 'lucide-react';

// Clear (✕) button for a search field. Sits at the right edge of the input, so
// the parent must be position:relative and the input needs right padding to
// keep its text from running underneath.
const SearchClear = ({ onClear, label = 'Clear search' }) => (
    <button
        type="button"
        onClick={onClear}
        aria-label={label}
        title={label}
        style={{
            position: 'absolute', right: '0.4rem', top: '50%', transform: 'translateY(-50%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '2rem', height: '2rem', padding: 0, borderRadius: '50%',
            border: 'none', background: 'var(--surface-sunken)', color: 'var(--text-secondary)',
            cursor: 'pointer', lineHeight: 1,
        }}
    >
        <X size={14} strokeWidth={2.5} />
    </button>
);

export default SearchClear;

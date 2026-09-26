// The event every picker hands to onChange. Existing call sites were written
// against native controls and read `e.target.value` (and one, Register.jsx,
// `e.target.name`), so the pickers emit the same shape: swapping
// <select onChange={e => set(e.target.value)}> for <Select ...> needs no handler
// change. The value is always a string, exactly as a native control reports it
// ('' when empty), so callers keep their own Number()/null conversions.
export interface PickerChangeEvent {
    target: { value: string; name: string };
    currentTarget: { value: string; name: string };
    type: 'change';
    preventDefault: () => void;
    stopPropagation: () => void;
    persist: () => void;
}

export const makeChangeEvent = (value: string, name = ''): PickerChangeEvent => {
    const target = { value, name };
    return {
        target,
        currentTarget: target,
        type: 'change',
        preventDefault: () => {},
        stopPropagation: () => {},
        persist: () => {},
    };
};

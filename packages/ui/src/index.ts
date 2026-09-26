// @bookplus/ui — shared helpers and components for the customer + business apps.
//
// App-styled replacements for the controls the browser would otherwise draw
// itself (native select lists, date/time pickers, confirm/alert boxes), themed
// only with @bookplus/design-tokens variables so light and dark mode both follow.
// Each picker's onChange gets { target: { value, name } } with a string value,
// like the native control it replaces.
export { Select } from './Select';
export type { SelectProps, SelectOption, SelectAction } from './Select';

export { DatePicker } from './DatePicker';
export type { DatePickerProps } from './DatePicker';

export { TimePicker } from './TimePicker';
export type { TimePickerProps } from './TimePicker';

export { ConfirmProvider, useConfirm, useAlert } from './Confirm';
export type { ConfirmOptions, AlertOptions, ConfirmInput, AlertInput, ConfirmFn, AlertFn } from './Confirm';

export type { PickerChangeEvent } from './internal/event';

// Durations read the same in both apps: "45 min", "1 hr", "2 hr 30 min".
export { formatDuration } from './formatDuration';

// A <label htmlFor> tied to its control by useId (plus hint/error wiring).
export { Field } from './Field';
export type { FieldProps } from './Field';

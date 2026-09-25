// @bookplus/ui — shared component library for the customer + business apps.
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

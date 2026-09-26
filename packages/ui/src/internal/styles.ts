// Stylesheet for @bookplus/ui, injected once by useInjectStyles(). Colours come
// from the design tokens (@bookplus/design-tokens/tokens.css), which flip under
// body.dark-mode, so dark mode needs no colour rules of its own. Class names are
// bp- prefixed.
//
// Literal colours, kept to a minimum: the scrim and the selected-row tint each
// have a token-based color-mix() upgrade right after them (browsers without
// color-mix() keep the literal), and the danger button's text is white, like
// the app's own .btn-danger. The three body.dark-mode rules exist only because
// the app's `body.dark-mode .input, body.dark-mode input { border-color: … !important }`
// would otherwise hide the open/invalid/focused borders.
export const CSS = `
@keyframes bp-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes bp-pop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes bp-rise { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes bp-dialog-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: none; } }

/* ── Trigger: a <button class="input bp-trigger">, so it inherits the app's input look ── */
.bp-trigger {
  display: flex; align-items: center; gap: 0.5rem; text-align: left; cursor: pointer;
  font-family: var(--font-body); line-height: 1.25; -webkit-tap-highlight-color: transparent;
  min-width: 0; margin: 0;
}
.bp-trigger[aria-expanded="true"] { border-color: var(--gold); }
body.dark-mode .bp-trigger[aria-expanded="true"] { border-color: var(--gold) !important; }
body.dark-mode .bp-trigger[aria-invalid="true"] { border-color: var(--danger) !important; }
.bp-trigger:disabled { opacity: 0.55; cursor: not-allowed; }
.bp-trigger-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
.bp-trigger[data-empty="true"] .bp-trigger-text { color: var(--text-muted); }
.bp-trigger-icon { flex-shrink: 0; display: inline-flex; color: var(--text-muted); transition: transform var(--dur-fast) var(--ease-out); }
.bp-trigger[aria-expanded="true"] .bp-trigger-icon.bp-rotates { transform: rotate(180deg); }
.bp-trigger-clear {
  flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; margin: -4px 0; border-radius: var(--radius-pill);
  color: var(--text-muted); cursor: pointer;
}
.bp-trigger-clear:hover { background: var(--surface-sunken); color: var(--text-primary); }
.bp-trigger.bp-sm { padding: 0.4rem 0.6rem; font-size: 0.8rem; gap: 0.35rem; border-radius: var(--radius-sm); }
.bp-tnum { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }

/* ── Layers ── */
.bp-scrim {
  position: fixed; inset: 0;
  background: rgba(4, 5, 5, 0.55);
  background: color-mix(in srgb, var(--ink) 55%, transparent);
  animation: bp-fade var(--dur) ease backwards;
}
.bp-pop {
  position: fixed; display: flex; flex-direction: column; overflow: hidden;
  background: var(--card-bg); color: var(--text-primary);
  border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: var(--shadow-lg); font-family: var(--font-body);
  animation: bp-pop var(--dur-fast) var(--ease-out) backwards;
}
.bp-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column;
  max-height: 85vh; max-height: 85dvh;
  background: var(--card-bg); color: var(--text-primary);
  border: 1px solid var(--border); border-bottom: none;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  box-shadow: var(--shadow-lg); font-family: var(--font-body);
  padding-bottom: max(env(safe-area-inset-bottom, 0px), var(--space-2));
  animation: bp-rise var(--dur-slow) var(--ease-out) backwards;
  transition: transform var(--dur) var(--ease-out);
}
.bp-sheet-grab { flex: none; padding: 10px 16px 6px; touch-action: none; cursor: grab; }
.bp-handle { width: 40px; height: 5px; margin: 0 auto; border-radius: var(--radius-pill); background: var(--border); }
.bp-sheet-head { position: relative; display: flex; align-items: center; justify-content: center; min-height: 40px; margin-top: 4px; padding: 0 44px; }
.bp-sheet-title {
  margin: 0; text-align: center; font-family: var(--font-display);
  font-weight: 600; font-size: 1.05rem; color: var(--charcoal);
}
/* Same shape as the app's CloseButton: a small glyph in a 44px hit area. */
.bp-sheet-close {
  position: absolute; right: -8px; top: 50%; transform: translateY(-50%);
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; padding: 0; border: none; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-muted); cursor: pointer; touch-action: manipulation;
}
.bp-sheet-close:hover { color: var(--text-primary); }

/* ── Option list (Select) ── */
.bp-search-wrap { flex: none; position: relative; padding: var(--space-2) var(--space-2) var(--space-1); }
.bp-sheet .bp-search-wrap { padding: var(--space-2) var(--space-4) var(--space-1); }
.bp-search-icon { position: absolute; left: calc(var(--space-2) + 12px); top: calc(50% + (var(--space-2) - var(--space-1)) / 2); transform: translateY(-50%); color: var(--text-muted); display: inline-flex; pointer-events: none; }
.bp-sheet .bp-search-icon { left: calc(var(--space-4) + 12px); }
.bp-search {
  width: 100%; box-sizing: border-box; margin: 0;
  padding: 0.6rem 0.75rem 0.6rem 2.2rem;
  font-family: var(--font-body); font-size: 1rem; color: var(--text-primary);
  background: var(--input-bg); border: 1.5px solid var(--border); border-radius: var(--radius-sm);
  outline: none; -webkit-appearance: none; appearance: none;
}
.bp-search:focus { border-color: var(--gold); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gold) 12%, transparent); }
.bp-search:focus-visible { outline: none; }
body.dark-mode .bp-search:focus { border-color: var(--gold) !important; }
.bp-search::placeholder { color: var(--text-muted); opacity: 1; }
.bp-list {
  position: relative; flex: 1 1 auto; min-height: 0; overflow-y: auto; margin: 0;
  padding: var(--space-1) var(--space-2) var(--space-2); outline: none;
  overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
}
.bp-sheet .bp-list { padding: var(--space-2) var(--space-4) var(--space-2); }
.bp-group-label {
  padding: 0.7rem 0.75rem 0.3rem; font-size: 0.68rem; font-weight: 700;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted);
}
.bp-opt {
  display: flex; align-items: center; gap: 0.6rem; min-height: 40px; box-sizing: border-box;
  padding: 0.55rem 0.75rem; margin: 1px 0; border-radius: var(--radius-sm);
  font-size: 0.92rem; line-height: 1.35; color: var(--text-primary);
  cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
}
.bp-sheet .bp-opt { min-height: 48px; font-size: 1rem; padding: 0.7rem 0.85rem; }
.bp-opt-body { flex: 1 1 auto; min-width: 0; }
.bp-opt-label { display: block; overflow-wrap: anywhere; }
.bp-opt-desc { display: block; margin-top: 2px; font-size: 0.78rem; color: var(--text-secondary); font-weight: 400; }
.bp-opt[data-active="true"] { background: var(--surface-sunken); }
/* DOM focus stays on the trigger or search box (aria-activedescendant), so the
   highlighted row needs an indicator of its own; the grey fill alone all but
   vanishes on the dark card. --gold holds 3:1 on both cards, selected or not. */
.bp-list[data-keyboard="true"] .bp-opt[data-active="true"] { box-shadow: inset 0 0 0 2px var(--gold); }
@media (hover: hover) {
  .bp-opt:not([aria-selected="true"]):not([aria-disabled="true"]):hover { background: var(--surface-sunken); }
}
.bp-opt[aria-selected="true"] {
  font-weight: 600; color: var(--charcoal);
  background: var(--surface-sunken);
  background: color-mix(in srgb, var(--gold) 10%, transparent);
}
.bp-opt[aria-selected="true"][data-active="true"] { background: color-mix(in srgb, var(--gold) 16%, transparent); }
.bp-opt[aria-disabled="true"] { opacity: 0.4; cursor: not-allowed; }
.bp-opt-check { flex-shrink: 0; display: inline-flex; color: var(--gold); }
.bp-opt-action { color: var(--gold-dark); font-weight: 600; }
.bp-opt-action .bp-opt-check { color: var(--gold-dark); }
.bp-divider { height: 1px; margin: var(--space-1) 0.25rem; background: var(--border); }
.bp-empty { padding: 1rem 0.75rem; text-align: center; font-size: 0.88rem; color: var(--text-muted); }

/* ── Shared small buttons (calendar nav, footer) ── */
.bp-icon-btn {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 36px; height: 36px; padding: 0; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: transparent; color: var(--charcoal); cursor: pointer;
}
.bp-icon-btn:hover:not(:disabled) { background: var(--surface-sunken); }
.bp-icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.bp-footer {
  flex: none; display: flex; align-items: center; justify-content: space-between; gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-3); border-top: 1px solid var(--border);
}
.bp-sheet .bp-footer { padding: var(--space-3) var(--space-4) var(--space-2); }
.bp-footer .btn-primary, .bp-footer .btn-outline { padding: 0.5rem 1.1rem; font-size: 0.85rem; }
.bp-sheet .bp-footer .btn-primary, .bp-sheet .bp-footer .btn-outline { padding: 0.7rem 1.4rem; font-size: 0.9rem; }
.bp-link-btn {
  background: none; border: none; padding: 0.4rem 0.5rem; margin: 0 -0.5rem; cursor: pointer;
  font-family: var(--font-body); font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);
  border-radius: var(--radius-sm);
}
.bp-link-btn:hover { color: var(--text-primary); background: var(--surface-sunken); }

/* ── Calendar (DatePicker) ── */
.bp-cal { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: var(--space-3) var(--space-3) var(--space-2); }
.bp-sheet .bp-cal { padding: var(--space-3) var(--space-4) var(--space-2); }
.bp-cal-inner { max-width: 380px; margin: 0 auto; }
.bp-cal-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-2); }
.bp-cal-title {
  display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.35rem 0.6rem;
  background: none; border: none; border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-display); font-weight: 600; font-size: 0.98rem; color: var(--charcoal);
}
.bp-cal-title:hover { background: var(--surface-sunken); }
.bp-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.bp-cal-dow {
  text-align: center; padding: 2px 0 4px; font-size: 0.64rem; font-weight: 600;
  letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted);
}
.bp-day {
  aspect-ratio: 1 / 1; min-height: 34px; display: flex; align-items: center; justify-content: center;
  padding: 0; border: 1.5px solid transparent; border-radius: 10px; background: transparent;
  font-family: var(--font-body); font-size: 0.85rem; font-weight: 500; color: var(--charcoal);
  font-variant-numeric: tabular-nums; cursor: pointer;
  transition: background var(--dur-fast) ease, border-color var(--dur-fast) ease;
}
.bp-sheet .bp-day { font-size: 0.95rem; min-height: 40px; }
.bp-day:hover { background: var(--surface-sunken); }
.bp-day[data-today="true"] { border-color: var(--text-muted); font-weight: 600; }
.bp-day[aria-selected="true"] { background: var(--gold); border-color: var(--gold); color: var(--ink); font-weight: 600; }
.bp-day[aria-disabled="true"] { opacity: 0.3; cursor: not-allowed; background: transparent; color: var(--text-muted); }
.bp-month-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.bp-month {
  padding: 0.75rem 0; border: 1.5px solid transparent; border-radius: var(--radius-sm); background: transparent;
  font-family: var(--font-body); font-size: 0.88rem; font-weight: 500; color: var(--charcoal); cursor: pointer;
}
.bp-month:hover { background: var(--surface-sunken); }
.bp-month[data-current="true"] { border-color: var(--border); }
.bp-month[aria-pressed="true"] { background: var(--gold); border-color: var(--gold); color: var(--ink); font-weight: 600; }
.bp-month:disabled { opacity: 0.3; cursor: not-allowed; }

/* ── Time columns (TimePicker) ── */
.bp-time { flex: 1 1 auto; min-height: 0; display: flex; gap: var(--space-2); padding: var(--space-2) var(--space-3); }
.bp-sheet .bp-time { padding: var(--space-2) var(--space-4); height: 44vh; height: 44dvh; }
.bp-time-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
.bp-time-col-label {
  flex: none; text-align: center; padding: 2px 0 6px; font-size: 0.64rem; font-weight: 600;
  letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted);
}
.bp-time-list {
  position: relative; flex: 1 1 auto; min-height: 0; overflow-y: auto; outline: none;
  overscroll-behavior: contain; -webkit-overflow-scrolling: touch; scrollbar-width: thin;
  border-radius: var(--radius-sm);
}
.bp-time-opt {
  display: block; width: 100%; margin: 1px 0; padding: 0.5rem 0; border: 1.5px solid transparent;
  border-radius: var(--radius-sm); background: transparent; cursor: pointer; text-align: center;
  font-family: var(--font-body); font-size: 0.95rem; font-weight: 500; color: var(--charcoal);
  font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';
}
.bp-sheet .bp-time-opt { padding: 0.7rem 0; font-size: 1.05rem; }
.bp-time-opt:hover { background: var(--surface-sunken); }
.bp-time-opt[data-active="true"] { border-color: var(--border); }
.bp-time-opt[aria-selected="true"] { background: var(--gold); border-color: var(--gold); color: var(--ink); font-weight: 600; }
.bp-time-opt[aria-disabled="true"] { opacity: 0.3; cursor: not-allowed; background: transparent; }
.bp-time-sep { flex: none; align-self: center; font-weight: 700; color: var(--text-muted); padding-top: 18px; }

/* ── Dialog (Confirm / Alert) ── */
.bp-dialog-wrap {
  position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  padding: max(var(--space-4), env(safe-area-inset-top, 0px)) var(--space-4) max(var(--space-4), env(safe-area-inset-bottom, 0px));
}
.bp-dialog {
  position: relative; width: 100%; max-width: 420px; box-sizing: border-box;
  max-height: calc(100vh - 2 * var(--space-4)); overflow-y: auto;
  padding: var(--space-6); background: var(--card-bg); color: var(--text-primary);
  border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-lg);
  font-family: var(--font-body); outline: none;
  animation: bp-dialog-in var(--dur-slow) var(--ease-out) backwards;
}
.bp-dialog-title {
  margin: 0 0 0.5rem; font-family: var(--font-display); font-weight: 600;
  font-size: 1.15rem; line-height: 1.3; color: var(--charcoal);
}
.bp-dialog[data-tone="danger"] .bp-dialog-title { color: var(--danger); }
.bp-dialog-msg { margin: 0; font-size: 0.9rem; line-height: 1.6; color: var(--text-secondary); white-space: pre-line; overflow-wrap: anywhere; }
.bp-dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-5); }
.bp-dialog-actions .btn-primary, .bp-dialog-actions .btn-outline { padding: 0.6rem 1.3rem; }
.bp-dialog-actions .bp-danger, .bp-dialog-actions .bp-danger:hover { background: var(--danger); color: #fff; }
@media (max-width: 420px) {
  .bp-dialog { padding: var(--space-5); }
  .bp-dialog-actions > * { flex: 1 1 0; }
}

@media (prefers-reduced-motion: reduce) {
  .bp-scrim, .bp-pop, .bp-sheet, .bp-dialog { animation: none; }
  .bp-sheet, .bp-trigger-icon, .bp-day { transition: none; }
}
`;

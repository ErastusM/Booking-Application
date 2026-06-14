# -*- coding: utf-8 -*-
import io, os

css_path = os.path.join(os.path.dirname(__file__), '..', 'src', 'styles', 'index.css')
css_path = os.path.abspath(css_path)

MARKER = 'PREMIUM DESIGN SYSTEM — primitives layer (Stage A)'
existing = io.open(css_path, encoding='utf-8').read()
if MARKER in existing:
    print('already appended, skipping')
    raise SystemExit(0)

block = r'''

/* ============================================================================
   PREMIUM DESIGN SYSTEM — primitives layer (Stage A)
   Reusable, token-driven components. Adopt incrementally across screens.
   ============================================================================ */

/* Button system */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  font-family: 'Outfit', sans-serif; font-weight: 600; font-size: 0.9rem; line-height: 1;
  padding: 0 1.25rem; height: 44px; border-radius: var(--radius-sm); border: 1.5px solid transparent;
  cursor: pointer; white-space: nowrap; user-select: none; position: relative;
  transition: transform var(--dur-fast) var(--ease-out), background-color var(--dur) ease,
              box-shadow var(--dur) ease, color var(--dur) ease, border-color var(--dur) ease, opacity var(--dur) ease;
}
.btn:active { transform: scale(0.97); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; pointer-events: none; }
.btn:focus-visible { outline: none; box-shadow: var(--shadow-focus); }
.btn-sm { height: 36px; font-size: 0.82rem; padding: 0 0.9rem; }
.btn-lg { height: 52px; font-size: 1rem; padding: 0 1.75rem; }
.btn-block { width: 100%; }
.btn--primary { background: var(--gold); color: var(--ink); }
.btn--primary:hover { background: var(--gold-light); box-shadow: var(--shadow-md); }
.btn--ink { background: var(--ink); color: var(--on-ink); }
.btn--ink:hover { background: #24243f; box-shadow: var(--shadow-md); }
.btn--outline { background: transparent; color: var(--charcoal); border-color: var(--border); }
.btn--outline:hover { border-color: var(--gold); color: var(--gold-dark); background: rgba(201,168,76,0.06); }
.btn--ghost { background: transparent; color: var(--text-secondary); }
.btn--ghost:hover { background: var(--surface-sunken); color: var(--charcoal); }
.btn--danger { background: var(--danger); color: #fff; }
.btn--danger:hover { background: #dc2626; box-shadow: var(--shadow-md); }
.btn--danger-soft { background: var(--danger-bg); color: var(--danger-fg); }
.btn--danger-soft:hover { background: #fecaca; }
.btn-icon { width: 44px; height: 44px; padding: 0; border-radius: var(--radius-sm); display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid transparent; color: var(--text-secondary); cursor: pointer; transition: background var(--dur) ease, color var(--dur) ease; }
.btn-icon:hover { background: var(--surface-sunken); color: var(--charcoal); }
.btn-icon.btn-sm { width: 36px; height: 36px; }
.btn .spin, .btn-spin { width: 16px; height: 16px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; opacity: 0.9; }

/* Form fields */
.field { display: flex; flex-direction: column; gap: 0.4rem; }
.field-label { font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); letter-spacing: 0.01em; }
.field-hint { font-size: 0.75rem; color: var(--text-muted); }
.field-error { font-size: 0.78rem; color: var(--danger-fg); display: flex; align-items: center; gap: 0.3rem; }
.input.is-invalid, .input[aria-invalid="true"] { border-color: var(--danger); }
.input.is-invalid:focus { box-shadow: 0 0 0 3px rgba(239,68,68,0.18); }
textarea.input { min-height: 88px; resize: vertical; line-height: 1.55; padding-top: 0.7rem; }
.input:hover:not(:focus) { border-color: #d8d4cc; }

/* Segmented control */
.segmented { display: inline-flex; background: var(--surface-sunken); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 3px; gap: 2px; }
.segmented button { appearance: none; border: none; background: transparent; cursor: pointer; font-family: 'Outfit', sans-serif;
  font-size: 0.82rem; font-weight: 600; color: var(--text-secondary); padding: 0.4rem 0.9rem; border-radius: 6px; transition: all var(--dur) var(--ease-out); white-space: nowrap; }
.segmented button:hover { color: var(--charcoal); }
.segmented button[aria-pressed="true"], .segmented button.is-active { background: var(--card-bg); color: var(--charcoal); box-shadow: var(--shadow-xs); }

/* Switch / toggle */
.switch { position: relative; display: inline-block; width: 46px; height: 26px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.switch .track { position: absolute; inset: 0; background: #cbd5e1; border-radius: var(--radius-pill); transition: background var(--dur) ease; cursor: pointer; }
.switch .track::before { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; background: #fff; border-radius: 50%; box-shadow: var(--shadow-xs); transition: transform var(--dur) var(--ease-out); }
.switch input:checked + .track { background: var(--gold); }
.switch input:checked + .track::before { transform: translateX(20px); }
.switch input:focus-visible + .track { box-shadow: var(--shadow-focus); }

/* Chips / pills */
.chip { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.3rem 0.75rem; border-radius: var(--radius-pill);
  font-size: 0.78rem; font-weight: 600; border: 1.5px solid var(--border); background: var(--card-bg); color: var(--text-secondary); cursor: pointer; transition: all var(--dur) var(--ease-out); }
.chip:hover { border-color: var(--gold); color: var(--gold-dark); }
.chip.is-active { border-color: var(--gold); background: rgba(201,168,76,0.12); color: var(--gold-dark); }

/* Semantic status badges */
.badge-success { background: var(--success-bg); color: var(--success-fg); }
.badge-info    { background: var(--info-bg);    color: var(--info-fg); }
.badge-warning { background: var(--warning-bg); color: var(--warning-fg); }
.badge-danger  { background: var(--danger-bg);  color: var(--danger-fg); }
.badge-neutral { background: var(--surface-sunken); color: var(--text-secondary); }

/* Skeleton shimmer */
.skeleton { position: relative; overflow: hidden; background: var(--surface-sunken); border-radius: var(--radius-sm); }
.skeleton::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent); animation: shimmer 1.4s infinite; }
body.dark-mode .skeleton::after { background: linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent); }
@keyframes shimmer { 100% { transform: translateX(100%); } }
.skeleton-line { height: 12px; border-radius: 6px; margin-bottom: 8px; }
.skeleton-title { height: 20px; width: 60%; border-radius: 6px; }

/* Tooltip (hover/focus) */
.tip { position: relative; }
.tip::after { content: attr(data-tip); position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%) translateY(4px);
  background: var(--ink); color: var(--on-ink); font-size: 0.72rem; font-weight: 500; padding: 0.35rem 0.6rem; border-radius: 6px;
  white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity var(--dur) ease, transform var(--dur) var(--ease-out); z-index: 1200; box-shadow: var(--shadow-md); }
.tip:hover::after, .tip:focus-visible::after { opacity: 1; transform: translateX(-50%) translateY(0); }

/* Card variants */
.card-interactive { cursor: pointer; }
.card-interactive:hover { box-shadow: var(--shadow-lg); transform: translateY(-3px); border-color: rgba(201,168,76,0.4); }
.card-flat { box-shadow: none; }

/* Entrance animation */
@keyframes scaleIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
.scale-in { animation: scaleIn var(--dur-slow) var(--ease-out) both; }

/* Refined scrollbars */
* { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; border: 2px solid transparent; background-clip: padding-box; }
*::-webkit-scrollbar-thumb:hover { background: var(--text-muted); background-clip: padding-box; }
*::-webkit-scrollbar-track { background: transparent; }

/* Hairline divider */
.hr { height: 1px; background: var(--border); border: none; margin: 1.25rem 0; }
'''

with io.open(css_path, 'a', encoding='utf-8', newline='') as f:
    f.write(block)
print('appended premium primitives layer')

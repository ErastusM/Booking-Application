# -*- coding: utf-8 -*-
import io, os
css_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src', 'styles', 'index.css'))
MARKER = 'APP SHELL — navigation + route transitions (Stage B)'
s = io.open(css_path, encoding='utf-8').read()
if MARKER in s:
    print('already appended, skipping'); raise SystemExit(0)

block = r'''

/* ============================================================================
   APP SHELL — navigation + route transitions (Stage B)
   ============================================================================ */

/* Route transition — fade + subtle rise on every navigation */
@keyframes routeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.route-view { animation: routeIn var(--dur-slow) var(--ease-out) both; }
@media (prefers-reduced-motion: reduce) { .route-view { animation: none; } }

/* Desktop nav links — pill hover/active */
.nav-pill {
  position: relative; text-decoration: none; font-size: 0.9rem; font-weight: 500;
  padding: 0.45rem 0.9rem; border-radius: var(--radius-pill);
  transition: color var(--dur) ease, background var(--dur) ease;
}

/* Bottom nav — active pill indicator + press feedback */
.bottom-nav .bnav-item { position: relative; -webkit-tap-highlight-color: transparent; transition: color var(--dur) ease; }
.bottom-nav .bnav-item .bnav-icon {
  display: flex; align-items: center; justify-content: center;
  width: 46px; height: 30px; border-radius: var(--radius-pill);
  transition: background var(--dur) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}
.bottom-nav .bnav-item.is-active .bnav-icon { background: rgba(201,168,76,0.16); }
.bottom-nav .bnav-item:active .bnav-icon { transform: scale(0.88); }
'''
with io.open(css_path, 'a', encoding='utf-8', newline='') as f:
    f.write(block)
print('appended shell css')

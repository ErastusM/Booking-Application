# -*- coding: utf-8 -*-
import io, os
css_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src', 'styles', 'index.css'))
MARKER = 'CALENDAR — drag/resize affordances (Stage C)'
s = io.open(css_path, encoding='utf-8').read()
if MARKER in s:
    print('already appended, skipping'); raise SystemExit(0)

block = r'''

/* ============================================================================
   CALENDAR — drag/resize affordances (Stage C)
   ============================================================================ */

/* Grab cursor on draggable appointment events */
.fc-bookplus-wrapper .fc-timegrid-event.fc-event-draggable,
.fc-bookplus-wrapper .fc-daygrid-event.fc-event-draggable { cursor: grab; }
.fc-bookplus-wrapper .fc-event.fc-event-dragging,
.fc-bookplus-wrapper .fc-event-mirror { cursor: grabbing; }

/* Bigger, more visible resize handle (touch-friendly) */
.fc-bookplus-wrapper .fc-timegrid-event .fc-event-resizer { height: 10px; }
.fc-bookplus-wrapper .fc-timegrid-event .fc-event-resizer-end::after {
  content: ''; position: absolute; left: 50%; bottom: 2px; transform: translateX(-50%);
  width: 24px; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.85);
  opacity: 0; transition: opacity var(--dur) ease;
}
.fc-bookplus-wrapper .fc-timegrid-event:hover .fc-event-resizer-end::after { opacity: 0.9; }

/* Smooth event transitions when not actively dragging */
.fc-bookplus-wrapper .fc-event { transition: box-shadow var(--dur) ease, transform var(--dur-fast) var(--ease-out); }

/* Calendar feedback toast entrance */
.cal-toast { animation: routeIn var(--dur) var(--ease-out) both; }
'''
with io.open(css_path, 'a', encoding='utf-8', newline='') as f:
    f.write(block)
print('appended calendar css')

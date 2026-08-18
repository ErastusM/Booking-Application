# Changelog

Versions mark product milestones on `main`. Each entry names the squash commit
that shipped it; annotated tags carry the same messages
(`scripts/backfill-version-tags.sh` pushes them if they're missing on origin).

## v1.0.0 — 2026-08-19
The platform runs a real business end to end, and the version now says so.
Everything below, plus: booking handover between staff (including to the
owner), the owner signal for turned-away bookings, the calendar opening at
working hours, mobile-safe working-hours editing with inverted-range
rejection, and app updates that reach phones on the next open
(#125–#129).

## v0.9.0 — 2026-08-18 · `b05fe43`
Identity split: login routes by account type, dual accounts choose their
destination, and the customer site knows who it is talking to (#123, #124).

## v0.8.0 — 2026-08-18 · `9005390`
Staff-aware booking: a solo owner's weekly hours no longer block online
booking, and the "any professional" picker matches the booking validator
(#121, #122).

## v0.7.0 — 2026-08-15 · `2277f9e`
Team invites send a real email with a truthful confirmation, and staff manage
their own service list (#120).

## v0.6.0 — 2026-08-12 · `8cc624d`
Staff time off: multi-day leave with types, owner approval, and self-service
requests (#117).

## v0.5.0 — 2026-08-12 · `0f161da`
Team management: tabbed member profiles, permissions, archiving, and
date-specific shifts with breaks (#105–#108).

## v0.4.0 — 2026-08-12 · `356d164`
Drag a booking to reschedule it, with a conflict chooser when the slot is
taken (#103).

## v0.3.0 — 2026-08-09 · `bbd1e76`
The bespoke full-screen calendar replaces FullCalendar; flat mobile
navigation (#83).

## Before v0.3.0
The foundation: appointment booking with services and availability, JWT auth
with rotating refresh tokens, payments/wallet, reviews, waitlists, recurring
bookings, the admin console, and the security-hardening sweeps (#78–#102).

#!/usr/bin/env bash
# Push the milestone version tags described in CHANGELOG.md.
# Run from a clone with push access: bash scripts/backfill-version-tags.sh
set -euo pipefail

tag() { git tag -f -a "$1" "$2" -m "$3"; }

tag v0.3.0 bbd1e76 "v0.3.0 — Bespoke full-screen calendar replaces FullCalendar; flat mobile nav"
tag v0.4.0 356d164 "v0.4.0 — Drag a booking to reschedule, with conflict resolution"
tag v0.5.0 0f161da "v0.5.0 — Team management: member profiles, permissions, archive, date-specific shifts with breaks"
tag v0.6.0 8cc624d "v0.6.0 — Staff time off: multi-day leave, types, self-service requests"
tag v0.7.0 2277f9e "v0.7.0 — Team invites with truthful email confirmation; staff manage their own services"
tag v0.8.0 9005390 "v0.8.0 — Staff-aware booking: solo-owner hours fix and staff-aware any-professional picker"
tag v0.9.0 b05fe43 "v0.9.0 — Identity split: login routes by account type, dual-account chooser, site boundaries"
# v1.0.0 goes on the squash commit of the PR that bumps the packages to 1.0.0:
# git tag -a v1.0.0 <squash-sha> -m "v1.0.0 — The platform runs a real business end to end" && git push origin v1.0.0

git push origin v0.3.0 v0.4.0 v0.5.0 v0.6.0 v0.7.0 v0.8.0 v0.9.0
echo "Milestone tags pushed."

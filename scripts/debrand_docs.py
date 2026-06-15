#!/usr/bin/env python3
"""One-off: replace 'barbershop' brand tokens with Bookplus across doc files."""
import io, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FILES = [
    "CLAUDE.md", "ARCHITECTURE.md", "COMPLETION_SUMMARY.txt", "FILE_INDEX.md",
    "PROJECT_SUMMARY.md", "QUICK_REFERENCE.md", "START_HERE.md", "SETUP.md",
    os.path.join(".github", "copilot-instructions.md"),
]
# Order matters: longer / cased variants first.
REPLACEMENTS = [
    ("BarberShop", "Bookplus"),
    ("Barbershop", "Bookplus"),
    ("BARBERSHOP", "BOOKPLUS"),
    ("Barber Shop", "Bookplus"),
    ("barber shop", "Bookplus"),
    ("barbershop", "bookplus"),
]

total = 0
for rel in FILES:
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        continue
    s = io.open(path, encoding="utf-8").read()
    n = sum(s.count(a) for a, _ in REPLACEMENTS)
    if n == 0:
        continue
    for a, b in REPLACEMENTS:
        s = s.replace(a, b)
    io.open(path, "w", encoding="utf-8", newline="").write(s)
    total += n
    print(f"{rel}: {n} replaced")
print("TOTAL:", total)

# Design

## Brand

Bookplus is a premium multi-role booking platform. The interface should feel modern, efficient, and trustworthy, with a refined service-led tone rather than a generic SaaS shell.

## Visual Direction

The visual language is warm-structured and high-contrast: near-black surfaces, brand-orange accents, off-white backgrounds, clean borders, and a display/body type pairing to separate hierarchy from body copy.

## Color System

- Primary: brand orange `#f03e16` for actions and emphasis
- Base: near-black `#040505` and off-white `#e6e8e7` for contrast and clarity
- Supporting neutrals: warm gray, muted text, soft borders
- Status colors: reserved for booking states and alerts only
- All values come from `@bookplus/design-tokens/tokens.css` — never redeclare tokens locally

## Typography

- Headings: Plus Jakarta Sans via `var(--font-display)` for a confident, modern hierarchy
- Body: Inter via `var(--font-body)` for crisp, readable UI text (both self-hosted via @fontsource-variable — never hardcode family names)
- Use strong size contrast, balanced line lengths, and calm spacing

## Shape & Elevation

- Cards: white surfaces, subtle borders, soft shadow, rounded corners
- Buttons: compact, tactile, and consistent across the app
- Inputs: clear focus states, readable placeholder behavior, no cluttered chrome

## Layout Principles

- Keep desktop layouts spacious but bounded
- Collapse multi-column layouts explicitly on mobile
- Prioritize the primary workflow over decorative sections
- Use tables, panels, and cards only when they improve clarity

## Motion

- Motion should be short, purposeful, and easy to interrupt
- Use subtle transitions for hover, drawer, modal, and confirmation states
- Respect reduced-motion preferences

## Component Notes

- Navigation should stay compact and role-aware
- Dashboards should surface status, availability, and next actions first
- Public pages should feel welcoming without becoming marketing-heavy
- Form states must remain legible in error, loading, and empty conditions

## Responsive Behavior

- One-column layouts on small screens where the content is task-oriented
- Preserve touch-friendly targets and readable text sizes
- Prevent horizontal overflow in every shared surface
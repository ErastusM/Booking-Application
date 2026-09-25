import React from 'react';

// Inline stroke icons (lucide geometry) so the package needs no icon dependency.
// They draw in currentColor, so the surrounding token colour themes them.
type IconProps = { size?: number; className?: string };

const Svg = ({ size = 16, className, children }: IconProps & { children: React.ReactNode }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={className}
    >
        {children}
    </svg>
);

export const ChevronDown = (p: IconProps) => <Svg {...p}><polyline points="6 9 12 15 18 9" /></Svg>;
export const ChevronLeft = (p: IconProps) => <Svg {...p}><polyline points="15 18 9 12 15 6" /></Svg>;
export const ChevronRight = (p: IconProps) => <Svg {...p}><polyline points="9 18 15 12 9 6" /></Svg>;
export const Check = (p: IconProps) => <Svg {...p}><polyline points="20 6 9 17 4 12" /></Svg>;
export const Search = (p: IconProps) => <Svg {...p}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></Svg>;
export const X = (p: IconProps) => <Svg {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Svg>;
export const CalendarIcon = (p: IconProps) => (
    <Svg {...p}>
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
    </Svg>
);
export const ClockIcon = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Svg>;
export const Plus = (p: IconProps) => <Svg {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>;

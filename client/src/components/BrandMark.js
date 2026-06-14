import React, { useId } from 'react';

/**
 * Bookplus brand mark — ink squircle + off-white calendar + a single gold plus.
 * Geometry matches the app icons / favicon (see scripts/gen_icons.py), so the
 * in-app logo and the installed-app icon read as the same brand.
 */
const BrandMark = ({ size = 30, radius = 22, style }) => {
    const gid = useId();
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 100 100"
            xmlns="http://www.w3.org/2000/svg"
            style={style}
            aria-hidden="true"
            focusable="false"
        >
            <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#26263f" />
                    <stop offset="1" stopColor="#13131e" />
                </linearGradient>
            </defs>
            <rect x="2" y="2" width="96" height="96" rx={radius} fill={`url(#${gid})`} />
            <rect x="37" y="26" width="5" height="12" rx="2.5" fill="#f4f1ea" />
            <rect x="58" y="26" width="5" height="12" rx="2.5" fill="#f4f1ea" />
            <rect x="27" y="33" width="46" height="43" rx="7" fill="#f4f1ea" />
            <rect x="33" y="45" width="34" height="1.8" rx="0.9" fill="#cdbf9f" />
            <rect x="47.5" y="51" width="5" height="20" rx="2.5" fill="#c9a84c" />
            <rect x="40" y="58.5" width="20" height="5" rx="2.5" fill="#c9a84c" />
        </svg>
    );
};

export default BrandMark;

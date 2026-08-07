// JS mirror of tokens.css for the places CSS variables can't reach
// (inline style objects, charts, canvas, email templates).
// Keep in sync with tokens.css — that file is the source of truth.
// Brand palette: orange #f03e16 · black #040505 · white #e6e8e7.
// Legacy key NAMES (gold/charcoal/offWhite) kept for call-site stability.

const colors = {
    gold: '#f03e16',
    goldLight: '#ff6a45',
    goldDark: '#b32c0d',
    charcoal: '#040505',
    charcoalLight: '#1c1c1e',
    offWhite: '#e6e8e7',
    warmGray: '#dcdedd',
    textPrimary: '#040505',
    textSecondary: '#606663',
    textMuted: '#8f9391',
    border: '#d3d5d4',
    ink: '#040505',
    onInk: '#e6e8e7',
    success: '#10b981', successBg: '#d1fae5', successFg: '#065f46',
    info: '#3b82f6', infoBg: '#dbeafe', infoFg: '#1e40af',
    warning: '#f59e0b', warningBg: '#fef3c7', warningFg: '#92400e',
    danger: '#ef4444', dangerBg: '#fee2e2', dangerFg: '#991b1b',
};

const radius = { sm: '8px', DEFAULT: '14px', lg: '20px', pill: '999px' };

const fonts = {
    display: "'Plus Jakarta Sans', sans-serif",
    body: "'Inter', sans-serif",
};

module.exports = { colors, radius, fonts };

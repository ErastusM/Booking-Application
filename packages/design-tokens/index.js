// JS mirror of tokens.css for the places CSS variables can't reach
// (inline style objects, charts, canvas, email templates).
// Keep in sync with tokens.css — that file is the source of truth.

const colors = {
    gold: '#c9a84c',
    goldLight: '#e8c96d',
    goldDark: '#a8863a',
    charcoal: '#1a1a2e',
    charcoalLight: '#2d2d44',
    offWhite: '#fafaf8',
    warmGray: '#f5f3ef',
    textPrimary: '#1a1a2e',
    textSecondary: '#6b6b80',
    textMuted: '#9b9baa',
    border: '#e8e6e1',
    ink: '#1a1a2e',
    onInk: '#fafaf8',
    success: '#10b981', successBg: '#d1fae5', successFg: '#065f46',
    info: '#3b82f6', infoBg: '#dbeafe', infoFg: '#1e40af',
    warning: '#f59e0b', warningBg: '#fef3c7', warningFg: '#92400e',
    danger: '#ef4444', dangerBg: '#fee2e2', dangerFg: '#991b1b',
};

const radius = { sm: '8px', DEFAULT: '14px', lg: '20px', pill: '999px' };

const fonts = {
    display: "'Plus Jakarta Sans', sans-serif",
    body: "'Plus Jakarta Sans', sans-serif",
};

module.exports = { colors, radius, fonts };

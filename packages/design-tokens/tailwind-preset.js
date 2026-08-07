// Tailwind preset shared by all Bookplus apps.
//
// Color values track the brand palette in tokens.css (orange/black/white);
// the `gold`/`charcoal` KEY names are legacy — rename alongside the CSS vars
// in Epic 1+. fontFamily tracks tokens.css's --font-display/--font-body
// (Plus Jakarta Sans / Inter, both self-hosted via @fontsource-variable) —
// it previously named Playfair Display / DM Sans, fonts no app loads, so
// those utilities silently fell back. The boxShadow values predate the
// elevation scale in tokens.css — reconcile that drift in Epic 1, not here.
module.exports = {
    theme: {
        extend: {
            colors: {
                gold: {
                    DEFAULT: '#f03e16',
                    light: '#ff6a45',
                    dark: '#b32c0d',
                },
                charcoal: {
                    DEFAULT: '#040505',
                    light: '#1c1c1e',
                },
                'off-white': '#e6e8e7',
                'warm-gray': '#dcdedd',
            },
            fontFamily: {
                display: ['Plus Jakarta Sans Variable', 'Plus Jakarta Sans', 'sans-serif'],
                sans: ['Inter Variable', 'Inter', 'sans-serif'],
            },
            borderRadius: {
                DEFAULT: '14px',
                sm: '8px',
                lg: '20px',
            },
            boxShadow: {
                sm: '0 2px 8px rgba(4,5,5,0.06)',
                md: '0 4px 20px rgba(4,5,5,0.10)',
                lg: '0 8px 40px rgba(4,5,5,0.14)',
            },
        },
    },
};

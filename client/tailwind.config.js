module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: '#c9a84c',
          light: '#e8c96d',
          dark: '#a8863a',
        },
        charcoal: {
          DEFAULT: '#1a1a2e',
          light: '#2d2d44',
        },
        'off-white': '#fafaf8',
        'warm-gray': '#f5f3ef',
      },
      fontFamily: {
        display: ['Playfair Display', 'serif'],
        sans: ['DM Sans', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '14px',
        sm: '8px',
        lg: '20px',
      },
      boxShadow: {
        sm: '0 2px 8px rgba(26,26,46,0.06)',
        md: '0 4px 20px rgba(26,26,46,0.10)',
        lg: '0 8px 40px rgba(26,26,46,0.14)',
      },
    },
  },
  plugins: [],
};
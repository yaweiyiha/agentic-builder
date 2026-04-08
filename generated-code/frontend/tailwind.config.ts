import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#EF4444', // Red-500
        secondary: '#FCD34D', // Amber-300
        background: '#1F2937', // Gray-800
        text: '#F9FAFB', // Gray-50
        'text-muted': '#D1D5DB', // Gray-300
        card: '#374151', // Gray-700
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['Roboto Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;

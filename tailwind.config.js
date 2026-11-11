/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#050505', coal: '#0d0b0b', char: '#171313',
        blood: { 900: '#3a0707', 800: '#5c0a0a', 700: '#7a0b0b', 600: '#8f0d0d', 500: '#b01212', 400: '#d12a2a' },
        bone: '#f1e9df', ash: '#9a908a',
      },
      fontFamily: {
        display: ['"Bodoni Moda"', '"Playfair Display"', 'Didot', 'serif'],
        sans: ['Jost', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        pulseDot: { '0%,100%': { opacity: '.4' }, '50%': { opacity: '1' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        blink: { '0%,100%': { opacity: '0' }, '50%': { opacity: '1' } },
      },
      animation: { pulseDot: 'pulseDot 1.4s ease-in-out infinite', float: 'float 7s ease-in-out infinite', blink: 'blink 1s steps(2) infinite' },
    },
  },
  plugins: [],
}

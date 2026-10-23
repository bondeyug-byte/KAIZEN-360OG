/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Green glass theme (Oct 2026 redesign, from the team's reference images): mint canvas, frosted white
        // surfaces, deep forest-green brand, lime accent. NOTE: the brand token keeps its historical class name
        // `maroon` (used across every page); `brand` is the same colour under a neutral name for new code.
        ground: '#E9F1EA', surface: '#FFFFFF', ink: '#17251E', muted: '#5F6F66',
        line: '#DCE7DE', line2: '#C6D6C9',
        maroon: { DEFAULT: '#1E5240', dark: '#153C2F', soft: '#DCEBDF', ink: '#FFFFFF', 50: '#EEF6EF', 100: '#E0EEE2' },
        brand: { DEFAULT: '#1E5240', dark: '#153C2F', deep: '#123528', 50: '#EEF6EF', 100: '#E0EEE2' },
        lime: { DEFAULT: '#D6F07A', soft: '#EEF8C9', ink: '#22350B' },
        blush: '#E4EFE6', rose: '#8DB89A',
        terra: '#B4532F', route: '#2457C5', sand: '#F2EDE8', ok: '#1E7A4C', warn: '#9A5B06', bad: '#B42318',
      },
      fontFamily: {
        // IBM Plex (SIL Open Font Licence 1.1): one family for text and headings, its mono for times and codes
        display: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(23,37,30,.05)',
        glass: '0 1px 2px rgba(23,37,30,.06)',
        lift: '0 2px 4px rgba(31,35,41,.04), 0 10px 24px -10px rgba(31,35,41,.18)',
        pop: '0 24px 48px -16px rgba(31,35,41,.28), 0 2px 6px rgba(31,35,41,.06)',
      },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
}

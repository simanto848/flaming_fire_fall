import type { Config } from "tailwindcss";

/**
 * All colors resolve to CSS variables defined per theme in globals.css
 * (light "Clean white" / calm "Calm evening"),
 * so every component follows the active theme without class changes.
 */
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: {
          950: v("--c-void-950"),
          900: v("--c-void-900"),
          850: v("--c-void-850"),
          800: v("--c-void-800"),
          700: v("--c-void-700"),
          600: v("--c-void-600"),
        },
        line: { DEFAULT: v("--c-line"), bright: v("--c-line-bright") },
        ember: {
          300: v("--c-ember-300"),
          400: v("--c-ember-400"),
          500: v("--c-ember-500"),
          600: v("--c-ember-600"),
          700: v("--c-ember-700"),
        },
        flame: { 400: v("--c-flame-400"), 500: v("--c-flame-500"), 600: v("--c-flame-600") },
        ion: { 300: v("--c-ion-300"), 400: v("--c-ion-400"), 500: v("--c-ion-500") },
        pulse: { 300: v("--c-pulse-300"), 400: v("--c-pulse-400"), 500: v("--c-pulse-500") },
        nova: { 400: v("--c-nova-400"), 500: v("--c-nova-500") },
        volt: { 400: v("--c-volt-400"), 500: v("--c-volt-500") },
        mist: {
          100: v("--c-mist-100"),
          200: v("--c-mist-200"),
          300: v("--c-mist-300"),
          400: v("--c-mist-400"),
          500: v("--c-mist-500"),
          600: v("--c-mist-600"),
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "'SF Mono'", "monospace"],
        display: ["Orbitron", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "var(--c-shadow-glow)",
        "glow-ion": "var(--c-shadow-glow-ion)",
        panel: "var(--c-shadow-panel)",
      },
      keyframes: {
        "fade-up": { "0%": { opacity: "0", transform: "translateY(12px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        "pulse-dot": { "0%,100%": { opacity: "1", transform: "scale(1)" }, "50%": { opacity: "0.4", transform: "scale(0.8)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        "spin-slow": { to: { transform: "rotate(360deg)" } },
        drift: { "0%,100%": { transform: "translate(0,0)" }, "50%": { transform: "translate(20px,-16px)" } },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both",
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
        "spin-slow": "spin-slow 2.4s linear infinite",
        drift: "drift 16s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;

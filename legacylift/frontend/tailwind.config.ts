import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        // LegacyLift design system
        background: "#0a0a0a",
        card: "#111111",
        border: "#222222",
        primary: {
          DEFAULT: "#2563EB",
          foreground: "#FFFFFF",
        },
        success: "#00C48C",
        warning: "#F59E0B",
        error: "#EF4444",
        critical: "#7C3AED",
        "text-primary": "#FFFFFF",
        "text-secondary": "#888888",

        // Risk level colours
        risk: {
          low: "#00C48C",
          medium: "#F59E0B",
          high: "#EF4444",
          critical: "#7C3AED",
        },

        // Ownership category colours
        ownership: {
          finance: "#2563EB",
          compliance: "#7C3AED",
          product: "#00C48C",
          risk: "#EF4444",
          ops: "#F59E0B",
          engineering: "#888888",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;

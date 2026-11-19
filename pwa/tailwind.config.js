/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        hobo: {
          paper: "#F7F4EB",
          paperSolid: "#F7F4EB",
          paperHover: "#EEEADE",
          ink: "#383633",
          muted: "#8C8881",
          faint: "#B8B3A8",
          line: "#D9D4C7",
          lineDark: "#B5AFA0",
          red: "rgb(var(--hobo-accent-rgb, 201 74 56) / <alpha-value>)",
          redSoft: "rgb(var(--hobo-accent-rgb, 201 74 56) / 0.14)",
          redHeader: "rgb(var(--hobo-accent-rgb, 201 74 56) / 0.25)",
          satHeader: "rgba(140, 136, 129, 0.22)",
        },
      },
      fontFamily: {
        sans: [
          '"DINPro-Light"',
          '"DINPro"',
          '"DIN Pro"',
          '"FF DIN"',
          '"DIN Alternate"',
          '"Bahnschrift"',
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

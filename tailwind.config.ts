import type { Config } from "tailwindcss";

const config: Config = {
  // lib/ is scanned because lib/buttonStyles.ts is where the shared button
  // classes now live. Tailwind only generates utilities it can literally see in
  // a scanned file, so leaving lib/ out silently dropped every class that
  // wasn't also written somewhere under app/ or components/ -- px-5, py-2.5,
  // py-1.5 and hover:brightness-105 all vanished, and the buttons using them
  // rendered with no padding at all rather than erroring.
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Mirrors the `body` rule in app/globals.css. Without this, `font-sans`
      // is Tailwind's stock ui-sans-serif/system-ui stack -- i.e. NOT Inter --
      // so "reset this back to the body font" would quietly land on a
      // different typeface than everything around it.
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        paper: "#FAF7F2",
        ink: "#231F20",
        amber: "#E8963A",
        // Originally a true teal; shifted toward navy during the Jul 2026 logo redesign — kept the "teal" name to avoid touching every text-teal/bg-teal class across the codebase
        teal: "#264B5D", //previously teal: "#2B5F5C",
        line: "#E4DDD0",
      },
    },
  },
  plugins: [],
};
export default config;

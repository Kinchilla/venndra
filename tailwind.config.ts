import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
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

import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#FAF7F2",
        ink: "#231F20",
        amber: "#E8963A",
        teal: "#2B5F5C",
        line: "#E4DDD0",
      },
    },
  },
  plugins: [],
};
export default config;

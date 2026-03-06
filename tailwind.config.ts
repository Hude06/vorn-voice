import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/renderer/**/*.{ts,tsx,html}"]
};

export default config;

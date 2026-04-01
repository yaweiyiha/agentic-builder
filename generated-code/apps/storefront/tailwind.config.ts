import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          bg: "#ffffff",
          text: "#18181b",
        },
        secondary: {
          bg: "#f4f4f5",
          text: "#52525b",
        },
        accent: {
          primary: "#2563eb",
          hover: "#1d4ed8",
        }
      },
    },
  },
  plugins: [],
};
export default config;

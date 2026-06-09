import type { Config } from "tailwindcss";

// Toss풍 토큰: 뉴트럴 그레이 + 단일 블루 액센트, 넉넉한 라운드/여백
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#3182f6",
          50: "#eef5ff", 100: "#d9e8ff", 500: "#3182f6", 600: "#2670e0", 700: "#1b5bc0",
        },
        ok: "#12b886",
        warn: "#f59f00",
        danger: "#fa5252",
        ink: { DEFAULT: "#191f28", soft: "#4e5968", faint: "#8b95a1" },
        surface: { DEFAULT: "#ffffff", muted: "#f2f4f6", line: "#e5e8eb" },
      },
      borderRadius: { xl: "16px", "2xl": "20px" },
      boxShadow: { card: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)" },
    },
  },
  plugins: [],
};
export default config;

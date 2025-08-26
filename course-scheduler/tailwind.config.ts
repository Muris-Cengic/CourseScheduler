// tailwind.config.ts
import type { Config } from "tailwindcss";

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./**/*.{js,ts,jsx,tsx}", // include CourseScheduler.tsx if it's outside /src
  ],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;

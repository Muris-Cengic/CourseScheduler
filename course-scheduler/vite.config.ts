import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: "/https://github.com/Muris-Cengic/CourseScheduler.git/",
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  css: { transformer: "postcss", postcss: "./postcss.config.js" },
});

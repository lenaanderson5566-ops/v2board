import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    base: "/console/",
    build: {
        outDir: "../public/console",
        emptyOutDir: true,
        manifest: true,
        rollupOptions: { input: "src/main.tsx" },
    },
    server: { proxy: { "/api": "http://localhost:8080" } },
});

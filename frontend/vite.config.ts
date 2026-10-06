import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { userBundleIsolation } from "./build-isolation";
export default defineConfig({
    plugins: [
        react(),
        userBundleIsolation(),
        {
            name: "ascii-script-output",
            renderChunk(code) {
                // esbuild leaves Unicode in regex literals; escape those too before hashing.
                return {
                    code: code.replace(
                        /[\u0080-\uffff]/g,
                        (char) =>
                            "\\u" +
                            char.charCodeAt(0).toString(16).padStart(4, "0"),
                    ),
                    map: null,
                };
            },
        },
    ],
    base: "/console/",
    // Avoid charset guessing for executable scripts.
    esbuild: { charset: "ascii" },
    build: {
        outDir: "../public/console",
        emptyOutDir: true,
        manifest: true,
        rollupOptions: { input: "src/main.tsx" },
    },
    server: { proxy: { "/api": "http://localhost:8080" } },
});

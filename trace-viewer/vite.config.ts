import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The node server serves ./dist with an index.html fallback, so use relative
// asset paths and the default outDir.
export default defineConfig({
	base: "./",
	plugins: [react()],
	build: {
		outDir: "dist",
	},
});

import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		devtools(),
		tanstackRouter({
			target: "react",
			autoCodeSplitting: true,
		}),
		viteReact(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		proxy: {
			"/ws": {
				target: "http://localhost:3210",
				ws: true,
			},
			"/chat": {
				target: "http://localhost:3210",
				changeOrigin: true,
			},
			"/conversation": {
				target: "http://localhost:3210",
				changeOrigin: true,
			},
			"/jobs": {
				target: "http://localhost:3210",
				changeOrigin: true,
			},
			"/health": {
				target: "http://localhost:3210",
				changeOrigin: true,
			},
		},
	},
});

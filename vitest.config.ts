import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		clearMocks: true,
	},
	resolve: {
		alias: {
			obsidian: resolve(__dirname, "tests/mocks/obsidian.ts"),
			"@electron/remote": resolve(__dirname, "tests/mocks/electron.ts"),
			src: resolve(__dirname, "src"),
		},
	},
});

import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		clearMocks: true,
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			thresholds: { lines: 50, functions: 30, statements: 40, branches: 50 },
		},
	},
	resolve: {
		alias: {
			obsidian: resolve(__dirname, "tests/mocks/obsidian.ts"),
			"@electron/remote": resolve(__dirname, "tests/mocks/electron.ts"),
			src: resolve(__dirname, "src"),
		},
	},
});

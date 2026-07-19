import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tsParser from "@typescript-eslint/parser";

export default defineConfig([
	{ ignores: ["node_modules/**", "main.js", "coverage/**"] },
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parser: tsParser,
			parserOptions: { project: "./tsconfig.json", sourceType: "module" },
		},
		rules: {
			"obsidianmd/ui/sentence-case": ["warn", {
				brands: ["Task Syncer", "Microsoft To Do", "TickTick", "SecretStorage", "OAuth", "Obsidian", "Markdown", "America/Toronto"],
				acronyms: ["API", "URL", "ID", "HTTP", "IANA"],
			}],
		},
	},
	{
		files: ["src/setting.ts", "src/delete-confirmation-modal.ts"],
		rules: {
			// Keep the APIs available at the declared Obsidian 1.11.4 compatibility floor.
			"@typescript-eslint/no-deprecated": "off",
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
		},
	},
	{
		files: ["tests/**/*.ts"],
		languageOptions: { parser: tsParser, parserOptions: { project: "./tsconfig.json", sourceType: "module" } },
		rules: {
			// Test doubles intentionally cross untyped framework boundaries. Keep
			// syntax and Obsidian linting without production's type-aware unsafe rules.
			"@typescript-eslint/await-thenable": "off",
			"@typescript-eslint/no-misused-promises": "off",
			"@typescript-eslint/no-unnecessary-type-assertion": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"obsidianmd/hardcoded-config-path": "off",
		},
	},
	{
		files: ["tests/main-lifecycle.test.ts"],
		rules: {
			// TaskService methods are Vitest function properties in this integration mock.
			"@typescript-eslint/unbound-method": "off",
		},
	},
	{
		files: ["*.config.ts"],
		languageOptions: { parser: tsParser, parserOptions: { project: "./tsconfig.json", sourceType: "module" } },
	},
	{
		files: ["scripts/validate-release.mjs"],
		rules: { "obsidianmd/rule-custom-message": "off" },
	},
]);

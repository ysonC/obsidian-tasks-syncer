import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import globals from "globals";

export default [
	{ ignores: ["node_modules/**", "main.js", "coverage/**"] },
	js.configs.recommended,
	{
		files: ["**/*.js", "**/*.mjs"],
		languageOptions: {
			sourceType: "module",
			globals: globals.node,
		},
	},
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsParser,
			parserOptions: { sourceType: "module" },
			globals: { ...globals.browser, ...globals.node },
		},
		plugins: { "@typescript-eslint": tsPlugin },
		rules: {
			...tsPlugin.configs.recommended.rules,
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"@typescript-eslint/no-empty-function": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"no-prototype-builtins": "off",
		},
	},
];

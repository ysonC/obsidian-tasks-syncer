import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PLUGIN_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const REQUIRED_STRING_FIELDS = ["id", "name", "version", "minAppVersion", "description", "author"];
const REQUIRED_RELEASE_ASSETS = ["main.js", "manifest.json", "styles.css"];

async function readJson(root, filename) {
	try {
		return JSON.parse(await readFile(resolve(root, filename), "utf8"));
	} catch (error) {
		throw new Error(`${filename} must exist and contain valid JSON: ${error.message}`);
	}
}

function isNonEmptyString(value) {
	return typeof value === "string" && value.trim() === value && value.length > 0;
}

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value) {
	try {
		const url = new URL(value);
		return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
	} catch {
		return false;
	}
}

async function assetExists(root, asset) {
	try {
		const details = await stat(resolve(root, asset));
		return details.isFile() && details.size > 0;
	} catch {
		return false;
	}
}

export async function validateRelease(rootDirectory = process.cwd()) {
	const root = resolve(rootDirectory);
	const [manifest, packageJson, versions] = await Promise.all([
		readJson(root, "manifest.json"),
		readJson(root, "package.json"),
		readJson(root, "versions.json"),
	]);
	const errors = [];
	for (const [filename, value] of [
		["manifest.json", manifest],
		["package.json", packageJson],
		["versions.json", versions],
	]) {
		if (!isPlainObject(value)) {
			errors.push(`${filename} must contain a JSON object at its root`);
		}
	}
	if (errors.length > 0) {
		throw new Error(`Release validation failed:\n- ${errors.join("\n- ")}`);
	}

	for (const field of REQUIRED_STRING_FIELDS) {
		if (!isNonEmptyString(manifest[field])) {
			errors.push(`manifest.json field ${field} must be a non-empty, trimmed string`);
		}
	}

	if (!EXACT_VERSION.test(manifest.version ?? "")) {
		errors.push("manifest.json version must use exact x.y.z format (no v prefix or prerelease suffix)");
	}
	if (!EXACT_VERSION.test(packageJson.version ?? "")) {
		errors.push("package.json version must use exact x.y.z format (no v prefix or prerelease suffix)");
	}
	if (packageJson.version !== manifest.version) {
		errors.push(`package.json version ${JSON.stringify(packageJson.version)} must equal manifest.json version ${JSON.stringify(manifest.version)}`);
	}
	if (!EXACT_VERSION.test(manifest.minAppVersion ?? "")) {
		errors.push("manifest.json minAppVersion must use exact x.y.z format");
	}

	if (!PLUGIN_ID.test(manifest.id ?? "")) {
		errors.push("manifest.json id must contain only lowercase letters, numbers, and non-leading/trailing hyphens");
	}
	if (typeof manifest.id === "string" && manifest.id.includes("obsidian")) {
		errors.push('manifest.json id must not contain "obsidian"');
	}
	if (manifest.isDesktopOnly !== true) {
		errors.push("manifest.json isDesktopOnly must be true because the plugin uses Node/Electron APIs");
	}
	if (Object.hasOwn(manifest, "fundingUrl")) {
		errors.push("manifest.json must not contain fundingUrl");
	}
	if (Object.hasOwn(manifest, "css")) {
		errors.push("manifest.json must not contain css; Obsidian loads styles.css automatically");
	}
	if (Object.hasOwn(manifest, "authorUrl") && !isHttpUrl(manifest.authorUrl)) {
		errors.push("manifest.json authorUrl must be a valid HTTP(S) URL when present");
	}

	if (versions[manifest.version] !== manifest.minAppVersion) {
		errors.push(`versions.json must map ${manifest.version} to ${manifest.minAppVersion}`);
	}

	for (const asset of REQUIRED_RELEASE_ASSETS) {
		if (!(await assetExists(root, asset))) {
			errors.push(`required release asset ${asset} is missing or empty`);
		}
	}

	if (errors.length > 0) {
		throw new Error(`Release validation failed:\n- ${errors.join("\n- ")}`);
	}

	return { version: manifest.version };
}

async function main() {
	try {
		const { version } = await validateRelease(process.argv[2] ?? process.cwd());
		console.log(`Release metadata and assets valid for ${version}.`);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	await main();
}

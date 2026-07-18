import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { decideReleaseState, REQUIRED_RELEASE_ASSETS } from "./release-state.mjs";

async function describeFile(directory, name) {
	const path = join(directory, name);
	const [contents, metadata] = await Promise.all([readFile(path), stat(path)]);
	return {
		name,
		size: metadata.size,
		digest: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
	};
}

const [releaseJsonPath, verifiedDirectory, downloadedDirectory] = process.argv.slice(2);
if (!releaseJsonPath || !verifiedDirectory || !downloadedDirectory) {
	throw new Error("Usage: node scripts/evaluate-release-state.mjs <release.json> <verified-dir> <downloaded-dir>");
}

const tagExists = process.env.TAG_EXISTS === "true";
const releaseExists = process.env.RELEASE_EXISTS === "true";
const expectedAssets = await Promise.all(REQUIRED_RELEASE_ASSETS.map((name) => describeFile(verifiedDirectory, name)));
let release = null;

if (releaseExists) {
	const releaseDocument = JSON.parse(await readFile(releaseJsonPath, "utf8"));
	if (!releaseDocument || typeof releaseDocument !== "object" || Array.isArray(releaseDocument)) {
		throw new Error("release.json must contain a JSON object");
	}
	if (!Array.isArray(releaseDocument.assets)) throw new Error("release.json assets must be an array");

	const assets = await Promise.all(
		releaseDocument.assets.map(async ({ id, name, size }) => {
			if (typeof name !== "string" || !REQUIRED_RELEASE_ASSETS.includes(name)) {
				return { id, name, size, digest: null };
			}
			try {
				const file = await describeFile(downloadedDirectory, name);
				return { id, name, size, digest: file.digest };
			} catch (error) {
				if (error?.code === "ENOENT") return { id, name, size, digest: null };
				throw error;
			}
		}),
	);
	release = { assets };
}

const decision = decideReleaseState({
	currentSha: process.env.GITHUB_SHA,
	tag: tagExists ? { sha: process.env.TAG_COMMIT } : null,
	release,
	expectedAssets,
});

process.stdout.write(`action=${decision.action}\n`);
if (decision.reason) process.stdout.write(`reason=${decision.reason}\n`);
if (decision.action === "repair") {
	process.stdout.write(`missing_assets=${decision.missingAssets.join(",")}\n`);
	process.stdout.write(`unexpected_asset_ids=${decision.unexpectedAssetIds.join(",")}\n`);
}

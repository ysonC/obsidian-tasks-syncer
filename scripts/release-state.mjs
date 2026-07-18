export const REQUIRED_RELEASE_ASSETS = Object.freeze(["main.js", "manifest.json", "styles.css"]);

function sameAsset(expected, actual) {
	return Number.isInteger(actual.size)
		&& actual.size > 0
		&& actual.size === expected.size
		&& typeof actual.digest === "string"
		&& actual.digest === expected.digest;
}

/**
 * Choose the only safe mutation for an observed release state.
 * This function is deliberately pure so CI state transitions are unit-testable.
 */
export function decideReleaseState({ currentSha, tag, release, expectedAssets }) {
	if (release && !tag) return { action: "fail", reason: "release-without-tag" };
	if (tag && tag.sha !== currentSha) return { action: "fail", reason: "tag-sha-mismatch" };
	if (!tag) return { action: "create" };
	if (!release) return { action: "complete" };
	if (!Array.isArray(expectedAssets) || !Array.isArray(release.assets)) return { action: "fail", reason: "invalid-asset-state" };

	const expectedByName = new Map(expectedAssets.map((asset) => [asset.name, asset]));
	const actualByName = new Map();
	const unexpectedAssetIds = [];
	for (const asset of release.assets) {
		if (!asset || typeof asset.name !== "string") return { action: "fail", reason: "invalid-asset-state" };
		if (!expectedByName.has(asset.name)) {
			if (typeof asset.id !== "number" && typeof asset.id !== "string") return { action: "fail", reason: "unexpected-asset-missing-id" };
			unexpectedAssetIds.push(asset.id);
			continue;
		}
		if (actualByName.has(asset.name)) return { action: "fail", reason: "duplicate-required-asset" };
		actualByName.set(asset.name, asset);
	}

	const missingAssets = [];
	for (const expected of expectedAssets) {
		const actual = actualByName.get(expected.name);
		if (!actual) missingAssets.push(expected.name);
		else if (!sameAsset(expected, actual)) return { action: "fail", reason: "required-asset-digest-mismatch" };
	}
	if (missingAssets.length === 0 && unexpectedAssetIds.length === 0) return { action: "skip" };
	return { action: "repair", missingAssets, unexpectedAssetIds };
}

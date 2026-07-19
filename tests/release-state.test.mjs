import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideReleaseState } from "../scripts/release-state.mjs";

const currentSha = "1111111111111111111111111111111111111111";
const oldSha = "2222222222222222222222222222222222222222";
const expectedAssets = [
	{ name: "main.js", size: 7, digest: "sha256:main" },
	{ name: "manifest.json", size: 11, digest: "sha256:manifest" },
	{ name: "styles.css", size: 9, digest: "sha256:styles" },
];

function state(overrides = {}) {
	return {
		currentSha,
		tag: { sha: currentSha },
		release: { assets: expectedAssets.map((asset) => ({ ...asset })) },
		expectedAssets,
		...overrides,
	};
}

describe("decideReleaseState", () => {
	it("skips a complete release at the current SHA with matching digests", () => {
		assert.deepEqual(decideReleaseState(state()), { action: "skip" });
	});

	it("fails closed for a complete release whose tag points at an old SHA", () => {
		assert.deepEqual(decideReleaseState(state({ tag: { sha: oldSha } })), {
			action: "fail",
			reason: "tag-sha-mismatch",
		});
	});

	it("repairs an incomplete release at the current SHA", () => {
		assert.deepEqual(
			decideReleaseState(
				state({ release: { assets: expectedAssets.filter(({ name }) => name !== "styles.css") } }),
			),
			{ action: "repair", missingAssets: ["styles.css"], unexpectedAssetIds: [] },
		);
	});

	it("fails closed for an incomplete release whose tag points at an old SHA", () => {
		assert.deepEqual(
			decideReleaseState(
				state({
					tag: { sha: oldSha },
					release: { assets: expectedAssets.filter(({ name }) => name !== "styles.css") },
				}),
			),
			{ action: "fail", reason: "tag-sha-mismatch" },
		);
	});

	it("fails closed when a release exists without the exact tag", () => {
		assert.deepEqual(decideReleaseState(state({ tag: null })), {
			action: "fail",
			reason: "release-without-tag",
		});
	});

	it("completes a tag-only release at the current SHA", () => {
		assert.deepEqual(decideReleaseState(state({ release: null })), { action: "complete" });
	});

	it("creates the tag and release when neither exists", () => {
		assert.deepEqual(decideReleaseState(state({ tag: null, release: null })), { action: "create" });
	});

	it("fails closed when an existing required asset differs from the verified build", () => {
		const assets = expectedAssets.map((asset) =>
			asset.name === "main.js" ? { ...asset, digest: "sha256:different" } : { ...asset },
		);

		assert.deepEqual(decideReleaseState(state({ release: { assets } })), {
			action: "fail",
			reason: "required-asset-digest-mismatch",
		});
	});

	it("repairs only missing required and unexpected assets at the current SHA", () => {
		const releaseAssets = [
			...expectedAssets.filter(({ name }) => name !== "styles.css"),
			{ id: 44, name: "checksums.txt", size: 5, digest: null },
		];
		assert.deepEqual(decideReleaseState(state({ release: { assets: releaseAssets } })), {
			action: "repair",
			missingAssets: ["styles.css"],
			unexpectedAssetIds: [44],
		});
	});
});

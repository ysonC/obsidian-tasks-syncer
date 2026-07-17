import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateRelease } from "../scripts/validate-release.mjs";

const temporaryDirectories = [];

async function createFixture({
	manifest = {},
	packageJson = {},
	versions = { "2.1.0": "1.11.4" },
	assets = ["main.js", "styles.css"],
} = {}) {
	const root = await mkdtemp(join(tmpdir(), "task-syncer-release-"));
	temporaryDirectories.push(root);

	const validManifest = {
		id: "task-syncer-plugin",
		name: "Task Syncer",
		version: "2.1.0",
		minAppVersion: "1.11.4",
		description: "Sync tasks with supported task providers.",
		author: "Example Author",
		authorUrl: "https://example.com/author",
		isDesktopOnly: true,
		...manifest,
	};
	const validPackage = {
		name: "task-syncer-plugin",
		version: "2.1.0",
		...packageJson,
	};

	await Promise.all([
		writeFile(join(root, "manifest.json"), `${JSON.stringify(validManifest, null, 2)}\n`),
		writeFile(join(root, "package.json"), `${JSON.stringify(validPackage, null, 2)}\n`),
		writeFile(join(root, "versions.json"), `${JSON.stringify(versions, null, 2)}\n`),
		...assets.map((asset) => writeFile(join(root, asset), "fixture\n")),
	]);

	return root;
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function assertValidationError(root, pattern) {
	await assert.rejects(validateRelease(root), pattern);
}

describe("validateRelease", () => {
	it("accepts valid community release metadata and assets", async () => {
		const root = await createFixture();

		assert.deepEqual(await validateRelease(root), { version: "2.1.0" });
	});

	it("rejects mismatched manifest and package versions", async () => {
		const root = await createFixture({ packageJson: { version: "2.0.0" } });

		await assertValidationError(root, /package\.json version .* must equal manifest\.json version/i);
	});

	it("rejects a prefixed version", async () => {
		const root = await createFixture({
			manifest: { version: "v2.1.0" },
			packageJson: { version: "v2.1.0" },
			versions: { "v2.1.0": "1.11.4" },
		});

		await assertValidationError(root, /manifest\.json version must use exact x\.y\.z format/i);
	});

	it("rejects a missing versions.json mapping", async () => {
		const root = await createFixture({ versions: {} });

		await assertValidationError(root, /versions\.json must map 2\.1\.0 to 1\.11\.4/i);
	});

	it("rejects a versions.json mapping that differs from minAppVersion", async () => {
		const root = await createFixture({ versions: { "2.1.0": "1.10.0" } });

		await assertValidationError(root, /versions\.json must map 2\.1\.0 to 1\.11\.4/i);
	});

	it("rejects a missing required release asset", async () => {
		const root = await createFixture({ assets: ["styles.css"] });

		await assertValidationError(root, /required release asset main\.js is missing/i);
	});

	for (const filename of ["manifest.json", "package.json", "versions.json"]) {
		for (const invalidRoot of [null, []]) {
			it(`rejects ${filename} when its root is ${invalidRoot === null ? "null" : "an array"}`, async () => {
				const root = await createFixture();
				await writeFile(join(root, filename), `${JSON.stringify(invalidRoot)}\n`);

				await assertValidationError(root, new RegExp(`${filename.replace(".", "\\.")} must contain a JSON object`, "i"));
			});
		}
	}
});

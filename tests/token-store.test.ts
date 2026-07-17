import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacyTokenCache } from "../src/auth";

const directories: string[] = [];
function temporaryDirectory() {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "task-syncer-"));
	directories.push(directory);
	return directory;
}
afterEach(() => directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));

describe("Microsoft token cache migration", () => {
	it("moves the legacy cache to the provider-specific path with mode 0600", () => {
		const directory = temporaryDirectory();
		const legacy = path.join(directory, "token_cache.json");
		const current = path.join(directory, "microsoft-token-cache.json");
		fs.writeFileSync(legacy, "legacy", { mode: 0o644 });
		migrateLegacyTokenCache(legacy, current);
		expect(fs.existsSync(legacy)).toBe(false);
		expect(fs.readFileSync(current, "utf8")).toBe("legacy");
		expect(fs.statSync(current).mode & 0o777).toBe(0o600);
	});

	it("never overwrites an existing new cache and still enforces mode 0600", () => {
		const directory = temporaryDirectory();
		const legacy = path.join(directory, "token_cache.json");
		const current = path.join(directory, "microsoft-token-cache.json");
		fs.writeFileSync(legacy, "legacy");
		fs.writeFileSync(current, "current", { mode: 0o644 });
		migrateLegacyTokenCache(legacy, current);
		expect(fs.readFileSync(current, "utf8")).toBe("current");
		expect(fs.readFileSync(legacy, "utf8")).toBe("legacy");
		expect(fs.statSync(current).mode & 0o777).toBe(0o600);
	});
});

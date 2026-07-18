import { describe, expect, it } from "vitest";
import { resolvePluginDirectory } from "../src/plugin-path";

describe("plugin directory resolution", () => {
	it("uses Obsidian's actual manifest directory instead of assuming the plugin ID", () => {
		expect(resolvePluginDirectory(".obsidian/plugins/obsidian-tasks-syncer", "task-syncer-plugin", ".obsidian"))
			.toBe(".obsidian/plugins/obsidian-tasks-syncer");
	});

	it("falls back to the config directory and plugin ID when manifest.dir is unavailable", () => {
		expect(resolvePluginDirectory(undefined, "task-syncer", ".config/obsidian"))
			.toBe(".config/obsidian/plugins/task-syncer");
	});
}
);

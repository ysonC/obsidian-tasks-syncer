import { describe, expect, it } from "vitest";
import { resolvePluginDirectory } from "../src/plugin-path";

describe("plugin directory resolution", () => {
	it("uses Obsidian's actual manifest directory instead of assuming the plugin ID", () => {
		expect(resolvePluginDirectory("/vault", ".obsidian/plugins/obsidian-tasks-syncer", "task-syncer-plugin"))
			.toBe("/vault/.obsidian/plugins/obsidian-tasks-syncer");
	});

	it("falls back to the config directory and plugin ID when manifest.dir is unavailable", () => {
		expect(resolvePluginDirectory("/vault", undefined, "task-syncer-plugin"))
			.toBe("/vault/.obsidian/plugins/task-syncer-plugin");
	});
}
);

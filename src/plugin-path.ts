import * as path from "path";

/**
 * Resolve the real plugin installation directory reported by Obsidian.
 * `manifest.dir` is a vault-relative path and may differ from the plugin ID
 * when the plugin is installed manually from a repository checkout.
 */
export function resolvePluginDirectory(
	vaultBasePath: string,
	manifestDirectory: string | undefined,
	pluginId: string,
): string {
	return manifestDirectory
		? path.join(vaultBasePath, manifestDirectory)
		: path.join(vaultBasePath, ".obsidian", "plugins", pluginId);
}

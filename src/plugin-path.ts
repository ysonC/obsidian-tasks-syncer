export function resolvePluginDirectory(
	manifestDirectory: string | undefined,
	pluginId: string,
	configDirectory: string,
): string {
	const normalize = (value: string) => value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	return manifestDirectory ? normalize(manifestDirectory) : `${normalize(configDirectory)}/plugins/${pluginId}`;
}

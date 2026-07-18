export const GENERATED_START = "<!-- task-syncer:generated:start -->";
export const GENERATED_END = "<!-- task-syncer:generated:end -->";

/** Replaces only the section owned by Task Syncer and preserves all user-authored content. */
export function updateManagedTaskSection(content: string, generated: string): string {
	const start = content.indexOf(GENERATED_START);
	const end = content.indexOf(GENERATED_END);
	const duplicateStart = start >= 0 && content.indexOf(GENERATED_START, start + GENERATED_START.length) >= 0;
	const duplicateEnd = end >= 0 && content.indexOf(GENERATED_END, end + GENERATED_END.length) >= 0;
	if ((start < 0) !== (end < 0) || (start >= 0 && end < start) || duplicateStart || duplicateEnd) {
		throw new Error("Task Syncer managed-section markers are missing, duplicated, or corrupt; no changes were written.");
	}
	const section = `${GENERATED_START}\n${generated}\n${GENERATED_END}`;
	if (start < 0) {
		const separator = content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
		return `${content}${separator}${section}\n`;
	}
	return `${content.slice(0, start)}${section}${content.slice(end + GENERATED_END.length)}`;
}

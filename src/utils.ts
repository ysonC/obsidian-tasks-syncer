import { Notice } from "obsidian";

/**
 * Display a notification in Obsidian with optional type-based prefix.
 * @param message - Message to show
 * @param type - One of "error", "warning", "success", "info"
 */
export function notify(
	message: string,
	type: "error" | "warning" | "success" | "info" = "info",
): void {
	let prefix = "";
	switch (type) {
		case "error":
			prefix = "❌ ";
			break;
		case "warning":
			prefix = "⚠️ ";
			break;
		case "success":
			prefix = "✅ ";
			break;
	}
	new Notice(`${prefix}${message}`);
}

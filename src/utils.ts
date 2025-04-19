import confetti from "canvas-confetti";
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

/**
 * Single confetti “pop” using your 5‑burst pattern.
 * @param origin  Where it starts (0–1 in x & y). Default is center‑top.
 * @param count   Total particle budget. Default is 200.
 */
export function playConfetti(
	origin: { x: number; y: number } = { x: 0.5, y: 0.7 },
	count: number = 200,
) {
	const defaults = { origin };

	// helper to fire one of your bursts
	const fire = (particleRatio: number, opts: confetti.Options) => {
		confetti({
			...defaults,
			...opts,
			particleCount: Math.floor(count * particleRatio),
		});
	};

	// your five bursts, back‑to‑back:
	fire(0.25, { spread: 26, startVelocity: 55 });
	fire(0.2, { spread: 60 });
	fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
	fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
	fire(0.1, { spread: 120, startVelocity: 45 });
}

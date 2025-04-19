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
 * Play confetti animation base on the type in setting.
 * @param type "regular" | "big" | "superbig" for different confetti
 */
export function playConfetti(type: string) {
	switch (type) {
		case "regular":
			regularConfetti();
			break;

		case "big":
			regularConfetti(500);
			break;

		case "superbig":
			playBIGConfetti();
			break;
	}
}

/**
 * Single confetti “pop” using your 5‑burst pattern.
 * @param origin  Where it starts (0–1 in x & y). Default is center‑top.
 * @param count   Total particle budget. Default is 200.
 */
export function regularConfetti(
	count: number = 200,
	origin: { x: number; y: number } = { x: 0.5, y: 0.7 },
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

/**
 * Fire continuous two‑sided confetti for a given duration.
 * @param durationMs  How long to keep firing (in milliseconds). Default 15 s.
 * @param colors      Array of CSS colors to use. Default is scarlet & white.
 * @param countPerSide How many particles per frame on each side. Default 2.
 * @param spread       How wide the spray is. Default 55.
 */
export function playBIGConfetti(durationMs: number = 3_000) {
	const end = Date.now() + durationMs;

	const countPerSide: number = 5;
	const spread: number = 70;
	(function frame() {
		// left side burst
		confetti({
			particleCount: countPerSide,
			angle: 60,
			spread,
			origin: { x: 0 },
		});
		// right side burst
		confetti({
			particleCount: countPerSide,
			angle: 120,
			spread,
			origin: { x: 1 },
		});

		if (Date.now() < end) {
			requestAnimationFrame(frame);
		}
	})();
}

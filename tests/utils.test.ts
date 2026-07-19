import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("canvas-confetti", () => ({ default: vi.fn(() => undefined) }));
vi.mock("obsidian", () => ({ Notice: vi.fn() }));

import confetti from "canvas-confetti";
import { Notice } from "obsidian";
import { notify, playBIGConfetti, playConfetti, regularConfetti } from "../src/utils";

describe("utils", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("prefixes notices by notification type", () => {
		notify("failed", "error");
		notify("careful", "warning");
		notify("done", "success");
		notify("plain");

		expect(Notice).toHaveBeenNthCalledWith(1, "❌ failed");
		expect(Notice).toHaveBeenNthCalledWith(2, "⚠️ careful");
		expect(Notice).toHaveBeenNthCalledWith(3, "✅ done");
		expect(Notice).toHaveBeenNthCalledWith(4, "plain");
	});

	it("fires the five regular confetti bursts", () => {
		regularConfetti(200, { x: 0.25, y: 0.75 });

		expect(confetti).toHaveBeenCalledTimes(5);
		expect(confetti).toHaveBeenNthCalledWith(1, expect.objectContaining({ particleCount: 50, spread: 26, startVelocity: 55, origin: { x: 0.25, y: 0.75 } }));
		expect(confetti).toHaveBeenNthCalledWith(5, expect.objectContaining({ particleCount: 20, spread: 120, startVelocity: 45, origin: { x: 0.25, y: 0.75 } }));
	});

	it("dispatches regular and big confetti modes", () => {
		playConfetti("regular");
		expect(confetti).toHaveBeenCalledTimes(5);
		expect(confetti).toHaveBeenNthCalledWith(1, expect.objectContaining({ particleCount: 50 }));

		vi.clearAllMocks();
		playConfetti("big");
		expect(confetti).toHaveBeenCalledTimes(5);
		expect(confetti).toHaveBeenNthCalledWith(1, expect.objectContaining({ particleCount: 125 }));
	});

	it("fires one left and right burst for immediate big confetti", () => {
		playBIGConfetti(0);

		expect(confetti).toHaveBeenCalledTimes(2);
		expect(confetti).toHaveBeenNthCalledWith(1, expect.objectContaining({ angle: 60, origin: { x: 0 } }));
		expect(confetti).toHaveBeenNthCalledWith(2, expect.objectContaining({ angle: 120, origin: { x: 1 } }));
	});
});

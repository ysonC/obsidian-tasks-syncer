import { describe, expect, it, vi } from "vitest";
import { AutoSyncController, minutesToMilliseconds } from "../src/auto-sync";

function timers() {
	let callback: (() => void) | undefined;
	return {
		setInterval: vi.fn((next: () => void) => { callback = next; return 42; }),
		clearInterval: vi.fn(),
		fire: () => callback?.(),
	};
}

describe("AutoSyncController", () => {
	it.each([Number.NaN, Infinity, -1, 2, 600])("refuses invalid interval %s", value => {
		const setInterval = vi.fn(() => 1);
		const controller = new AutoSyncController(async () => {}, () => true, () => {}, { setInterval, clearInterval: vi.fn() });
		controller.configure(value);
		expect(setInterval).not.toHaveBeenCalled();
	});

	it("schedules the configured interval and replaces an existing schedule", () => {
		const clock = timers();
		const controller = new AutoSyncController(async () => {}, () => true, () => {}, clock);

		controller.configure(10);
		expect(clock.setInterval).toHaveBeenCalledWith(expect.any(Function), minutesToMilliseconds(10));

		controller.configure(30);
		expect(clock.clearInterval).toHaveBeenCalledWith(42);
		expect(clock.setInterval).toHaveBeenLastCalledWith(expect.any(Function), minutesToMilliseconds(30));
	});

	it("disables scheduling when the interval is zero", () => {
		const clock = timers();
		const controller = new AutoSyncController(async () => {}, () => true, () => {}, clock);
		controller.configure(0);
		expect(clock.setInterval).not.toHaveBeenCalled();
	});

	it("skips sync without a selected list and prevents overlapping syncs", async () => {
		let enabled = false;
		let finishSync: (() => void) | undefined;
		const sync = vi.fn(() => new Promise<void>(resolve => { finishSync = resolve; }));
		const controller = new AutoSyncController(sync, () => enabled, () => {}, timers());

		await expect(controller.run()).resolves.toBe(false);
		expect(sync).not.toHaveBeenCalled();

		enabled = true;
		const first = controller.run();
		await expect(controller.run()).resolves.toBe(false);
		expect(sync).toHaveBeenCalledOnce();
		finishSync?.();
		await expect(first).resolves.toBe(true);
	});

	it("reports background sync errors without throwing", async () => {
		const report = vi.fn();
		const failure = new Error("offline");
		const controller = new AutoSyncController(async () => { throw failure; }, () => true, report, timers());
		await expect(controller.run()).resolves.toBe(false);
		expect(report).toHaveBeenCalledWith(failure);
	});
});

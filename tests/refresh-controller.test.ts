import { describe, expect, it } from "vitest";
import { RefreshCoordinator } from "../src/refresh-controller";
import type { RefreshIdentity } from "../src/refresh-controller";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

describe("RefreshCoordinator", () => {
	it("discards an older refresh after the provider or list identity changes", async () => {
		let identity: RefreshIdentity = { provider: "microsoft", listId: "a", showCompleted: true, generation: 0 };
		const old = deferred<string[]>();
		const commits: string[][] = [];
		const coordinator = new RefreshCoordinator(() => identity, async () => old.promise, tasks => { commits.push(tasks); });
		const running = coordinator.refresh();
		identity = { provider: "ticktick", listId: "b", showCompleted: true, generation: 1 };
		old.resolve(["old"]);
		expect(await running).toEqual({ status: "discarded" });
		expect(commits).toEqual([]);
	});

	it("deduplicates overlapping refreshes for the same identity", async () => {
		const identity = { provider: "microsoft", listId: "a", showCompleted: true, generation: 0 } as const;
		const result = deferred<string[]>();
		let fetches = 0;
		const coordinator = new RefreshCoordinator(() => identity, async () => { fetches++; return result.promise; }, () => {});
		const first = coordinator.refresh();
		const second = coordinator.refresh();
		result.resolve(["one"]);
		expect(await first).toEqual({ status: "committed", value: ["one"] });
		expect(await second).toEqual({ status: "committed", value: ["one"] });
		expect(fetches).toBe(1);
	});

	it("serializes identity changes, supersedes queued work, and commits only the newest request", async () => {
		let identity: RefreshIdentity = { provider: "microsoft", listId: "a", showCompleted: true, generation: 0 };
		const requests = new Map<string, ReturnType<typeof deferred<string[]>>>();
		const commits: string[][] = [];
		let concurrency = 0;
		let maxConcurrency = 0;
		const coordinator = new RefreshCoordinator<string[]>(
			() => identity,
			async snapshot => {
				concurrency++;
				maxConcurrency = Math.max(maxConcurrency, concurrency);
				const request = deferred<string[]>();
				requests.set(snapshot.listId, request);
				try { return await request.promise; }
				finally { concurrency--; }
			},
			tasks => { commits.push(tasks); },
		);

		const first = coordinator.refresh();
		identity = { ...identity, listId: "b", generation: 1 };
		const superseded = coordinator.refresh();
		identity = { ...identity, listId: "c", generation: 2 };
		const newest = coordinator.refresh();

		expect(requests.has("b")).toBe(false);
		expect(requests.has("c")).toBe(false);
		expect(await superseded).toEqual({ status: "discarded" });
		requests.get("a")!.resolve(["old"]);
		expect(await first).toEqual({ status: "discarded" });
		await Promise.resolve();
		expect(requests.has("c")).toBe(true);
		expect(maxConcurrency).toBe(1);
		requests.get("c")!.resolve(["newest"]);
		expect(await newest).toEqual({ status: "committed", value: ["newest"] });
		expect(commits).toEqual([["newest"]]);
	});

	it("does not commit work after unload", async () => {
		const identity = { provider: "microsoft", listId: "a", showCompleted: true, generation: 0 } as const;
		const result = deferred<string[]>();
		const commits: string[][] = [];
		const coordinator = new RefreshCoordinator(() => identity, async () => result.promise, tasks => { commits.push(tasks); });
		const running = coordinator.refresh();
		coordinator.dispose();
		result.resolve(["late"]);
		expect(await running).toEqual({ status: "discarded" });
		expect(commits).toEqual([]);
	});

	it("discards queued work without starting it after unload", async () => {
		let identity: RefreshIdentity = { provider: "microsoft", listId: "a", showCompleted: true, generation: 0 };
		const active = deferred<string[]>();
		const fetched: string[] = [];
		const coordinator = new RefreshCoordinator(() => identity, async snapshot => {
			fetched.push(snapshot.listId);
			return active.promise;
		}, () => {});
		const first = coordinator.refresh();
		identity = { ...identity, listId: "b", generation: 1 };
		const queued = coordinator.refresh();
		coordinator.dispose();
		expect(await queued).toEqual({ status: "discarded" });
		active.resolve(["late"]);
		expect(await first).toEqual({ status: "discarded" });
		expect(fetched).toEqual(["a"]);
	});
});

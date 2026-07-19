import { describe, expect, it } from "vitest";
import { matchRemoteTask } from "../src/task-matching";
import type { TaskItem } from "../src/types";

const task = (id: string, title: string, status: "open" | "completed" = "open"): TaskItem => ({ id, listId: "list", title, status });

describe("remote task matching", () => {
	it("refuses duplicate normalized titles instead of choosing one", () => {
		expect(matchRemoteTask([task("1", "Deploy"), task("2", " deploy  ")], " DEPLOY ")).toEqual({ status: "ambiguous", matches: 2 });
	});
	it("returns the one unique normalized match", () => {
		expect(matchRemoteTask([task("1", "Deploy")], " deploy ")).toEqual({ status: "matched", task: task("1", "Deploy") });
	});
	it("reports no match", () => {
		expect(matchRemoteTask([task("1", "Deploy")], "Ship")).toEqual({ status: "none" });
	});
});

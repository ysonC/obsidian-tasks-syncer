import { describe, expect, it, vi } from "vitest";
import { TickTickTaskService, formatTickTickDate } from "../src/services/ticktick";

function response(status: number, json: any = {}, text = "") { return { status, json, text }; }

describe("TickTickTaskService", () => {
	it("uses documented endpoints and merges active/completed tasks by ID", async () => {
		const request = vi.fn()
			.mockResolvedValueOnce(response(200, [{ id: "p", name: "Inbox" }]))
			.mockResolvedValueOnce(response(200, { tasks: [{ id: "a", projectId: "p", title: " A ", status: 0, dueDate: "2026-07-17T00:00:00+0000" }] }))
			.mockResolvedValueOnce(response(200, [{ id: "a", projectId: "p", title: "A old", status: 2 }, { id: "b", projectId: "p", title: "B", status: 2 }]));
		const service = new TickTickTaskService(async () => "token", request, "America/Toronto");
		expect(await service.fetchTaskLists()).toEqual([{ id: "p", title: "Inbox" }]);
		expect(await service.fetchTasks("p", true)).toEqual([
			{ id: "a", listId: "p", title: "A", status: "completed", dueDate: "2026-07-17T00:00:00+0000" },
			{ id: "b", listId: "p", title: "B", status: "completed" },
		]);
		expect(request.mock.calls.map(c => [c[0].method, c[0].url])).toEqual([
			["GET", "https://api.ticktick.com/open/v1/project"],
			["GET", "https://api.ticktick.com/open/v1/project/p/data"],
			["POST", "https://api.ticktick.com/open/v1/task/completed"],
		]);
		expect(JSON.parse(request.mock.calls[2][0].body)).toEqual({
			projectIds: ["p"],
		});
	});

	it("creates, updates, completes, deletes, and renames with TickTick date/timezone payloads", async () => {
		const request = vi.fn().mockResolvedValue(response(200, { id: "t", projectId: "p", title: "T", status: 0 }));
		const service = new TickTickTaskService(async () => "token", request, "Europe/London");
		await service.createTask("p", { title: "T", dueDate: "2026-07-17T00:00:00" });
		await service.updateTask("p", "t", { title: "T2", dueDate: "2026-07-18T00:00:00" });
		await service.completeTask("p", "t"); await service.deleteTask("p", "t"); await service.renameTaskList!("p", "Work");
		expect(JSON.parse(request.mock.calls[0][0].body)).toMatchObject({ projectId: "p", title: "T", dueDate: "2026-07-17T00:00:00+0000", timeZone: "Europe/London", isAllDay: true });
		expect(request.mock.calls.slice(2).map(c => [c[0].method, c[0].url])).toEqual([
			["POST", "https://api.ticktick.com/open/v1/project/p/task/t/complete"], ["DELETE", "https://api.ticktick.com/open/v1/project/p/task/t"], ["POST", "https://api.ticktick.com/open/v1/project/p"]
		]);
		expect(formatTickTickDate("2026-07-17")).toBe("2026-07-17T00:00:00+0000");
		expect(service.capabilities.reopenTask).toBe(false);
	});

	it("omits absent create dates and clears update dates without all-day metadata", async () => {
		const request = vi.fn().mockResolvedValue(response(200, { id: "t", projectId: "p", title: "T", status: 0 }));
		const service = new TickTickTaskService(async () => "token", request, "Europe/London");
		await service.createTask("p", { title: "T" });
		await service.updateTask("p", "t", { dueDate: "" });
		expect(JSON.parse(request.mock.calls[0][0].body)).toEqual({ projectId: "p", title: "T" });
		expect(JSON.parse(request.mock.calls[1][0].body)).toEqual({ id: "t", projectId: "p", dueDate: null });
	});

	it.each([[401, "Connect TickTick"], [403, "permission"], [404, "not found"], [429, "rate limit"]])("returns sanitized actionable errors for %s", async (status, message) => {
		const clear = vi.fn(); const request = vi.fn().mockResolvedValue(response(status, {}, "secret response"));
		const service = new TickTickTaskService(async () => "token", request, "UTC", clear);
		await expect(service.fetchTaskLists()).rejects.toThrow(message as string);
		expect(JSON.stringify(request.mock.calls)).not.toContain("secret response");
		if (status === 401) expect(clear).toHaveBeenCalled();
	});
});

import { describe, expect, it, vi } from "vitest";
import { MicrosoftTaskService } from "../src/services/microsoft";

describe("Microsoft adapter", () => {
	it("uses explicit list IDs and normalizes Graph status and due dates", async () => {
		const request = vi.fn().mockResolvedValue({ status: 200, json: { value: [{ id: "t", title: " Task ", status: "notStarted", dueDateTime: { dateTime: "2026-07-17T00:00:00", timeZone: "UTC" } }] }, text: "" });
		const service = new MicrosoftTaskService(async () => "token", request);
		expect(await service.fetchTasks("list/one", false)).toEqual([{ id: "t", listId: "list/one", title: "Task", status: "open", dueDate: "2026-07-17T00:00:00" }]);
		expect(request.mock.calls[0][0].url).toContain("list%2Fone");
	});

	it("omits absent create dates and maps cleared update dates to null", async () => {
		const request = vi.fn().mockResolvedValue({ status: 200, json: { id: "t", title: "Task", status: "notStarted" }, text: "" });
		const service = new MicrosoftTaskService(async () => "token", request);
		await service.createTask("list", { title: "Task" });
		await service.updateTask("list", "t", { dueDate: "" });
		expect(JSON.parse(request.mock.calls[0][0].body)).toEqual({ title: "Task" });
		expect(JSON.parse(request.mock.calls[1][0].body)).toEqual({ dueDateTime: null });
	});

	it("follows safe Graph pagination for collections", async () => {
		const request = vi.fn()
			.mockResolvedValueOnce({ status: 200, json: { value: [{ id: "a", displayName: "A" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/todo/lists?$skiptoken=x" }, text: "" })
			.mockResolvedValueOnce({ status: 200, json: { value: [{ id: "b", displayName: "B" }] }, text: "" });
		const service = new MicrosoftTaskService(async () => "token", request);
		expect(await service.fetchTaskLists()).toEqual([{ id: "a", title: "A" }, { id: "b", title: "B" }]);
		expect(request).toHaveBeenCalledTimes(2);
	});

	it.each([
		"http://graph.microsoft.com/v1.0/next",
		"https://evil.example/steal",
		"https://graph.microsoft.com:444/v1.0/next",
		"https://attacker@graph.microsoft.com/v1.0/next",
	])("rejects unsafe Graph continuation %s", async nextLink => {
		const request = vi.fn().mockResolvedValue({ status: 200, json: { value: [], "@odata.nextLink": nextLink }, text: "" });
		await expect(new MicrosoftTaskService(async () => "token", request).fetchTaskLists()).rejects.toThrow(/next.*link|pagination/i);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it("rejects cyclic Graph pagination", async () => {
		const next = "https://graph.microsoft.com/v1.0/me/todo/lists";
		const request = vi.fn().mockResolvedValue({ status: 200, json: { value: [], "@odata.nextLink": next }, text: "" });
		await expect(new MicrosoftTaskService(async () => "token", request).fetchTaskLists()).rejects.toThrow(/cycle/i);
	});

	it("rejects malformed list collections with provider context", async () => {
		const request = vi.fn().mockResolvedValue({ status: 200, json: { value: {} }, text: "" });
		await expect(new MicrosoftTaskService(async () => "token", request).fetchTaskLists()).rejects.toThrow(/Microsoft.*lists/i);
	});
});

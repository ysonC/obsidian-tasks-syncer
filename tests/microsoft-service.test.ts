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
});

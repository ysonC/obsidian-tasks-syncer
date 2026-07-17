import { describe, expect, it, vi } from "vitest";
import {
	DeleteCompletedTasksError,
	deleteCompletedTasksAndRefresh,
	deleteCompletedTasksWithConfirmation,
} from "../src/delete-completed";

function service(tasks: Array<{ id: string; title: string; status: "open" | "completed" }>) {
	return {
		fetchTasks: vi.fn(async () => tasks),
		deleteTask: vi.fn(async () => {}),
	} as any;
}

describe("delete completed task orchestration", () => {
	it("fetches completed tasks and includes provider, list, and count in confirmation", async () => {
		const tasks = service([{ id: "1", title: "Done", status: "completed" }, { id: "2", title: "Open", status: "open" }]);
		const confirm = vi.fn(async () => false);
		await expect(deleteCompletedTasksWithConfirmation(tasks, "microsoft", "list-id", "Inbox", confirm)).resolves.toBe(0);
		expect(tasks.fetchTasks).toHaveBeenCalledWith("list-id", true);
		expect(confirm).toHaveBeenCalledWith({ provider: "Microsoft To Do", list: "Inbox", count: 1 });
		expect(tasks.deleteTask).not.toHaveBeenCalled();
	});

	it("deletes only completed tasks after explicit confirmation", async () => {
		const tasks = service([{ id: "1", title: "Done", status: "completed" }, { id: "2", title: "Open", status: "open" }]);
		await expect(deleteCompletedTasksWithConfirmation(tasks, "ticktick", "list-id", "Project", async () => true)).resolves.toBe(1);
		expect(tasks.deleteTask).toHaveBeenCalledTimes(1);
		expect(tasks.deleteTask).toHaveBeenCalledWith("list-id", "1");
	});

	it("does not prompt or delete when there are no completed tasks", async () => {
		const tasks = service([{ id: "2", title: "Open", status: "open" }]);
		const confirm = vi.fn(async () => true);
		await expect(deleteCompletedTasksWithConfirmation(tasks, "microsoft", "list-id", "Inbox", confirm)).resolves.toBe(0);
		expect(confirm).not.toHaveBeenCalled();
		expect(tasks.deleteTask).not.toHaveBeenCalled();
	});

	it("stops after a failed delete and reports the partial outcome", async () => {
		const tasks = service([
			{ id: "1", title: "First", status: "completed" },
			{ id: "2", title: "Second", status: "completed" },
			{ id: "3", title: "Third", status: "completed" },
		]);
		tasks.deleteTask.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("provider unavailable"));
		let failure: unknown;
		try {
			await deleteCompletedTasksWithConfirmation(tasks, "microsoft", "list-id", "Inbox", async () => true);
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(DeleteCompletedTasksError);
		expect(failure).toMatchObject({ deleted: 1, total: 3, attempted: 2, notAttempted: 1 });
		expect((failure as Error).message).toMatch(/1 of 3 deleted.*2 remain.*1 not attempted/i);
		expect(tasks.deleteTask).toHaveBeenCalledTimes(2);
	});

	it("refreshes after a partial deletion failure", async () => {
		const tasks = service([
			{ id: "1", title: "First", status: "completed" },
			{ id: "2", title: "Second", status: "completed" },
		]);
		tasks.deleteTask.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("provider unavailable"));
		const refresh = vi.fn(async () => {});
		await expect(deleteCompletedTasksAndRefresh(
			() => deleteCompletedTasksWithConfirmation(tasks, "ticktick", "list-id", "Project", async () => true),
			refresh,
		)).rejects.toThrow(/1 of 2 deleted/i);
		expect(refresh).toHaveBeenCalledOnce();
	});

	it("preserves a partial deletion error when refresh also fails", async () => {
		const deletionError = new DeleteCompletedTasksError(1, 3, new Error("delete unavailable"));
		const refresh = vi.fn(async () => { throw new Error("refresh unavailable"); });
		let failure: unknown;
		try {
			await deleteCompletedTasksAndRefresh(async () => { throw deletionError; }, refresh);
		} catch (error) {
			failure = error;
		}
		expect(failure).toBe(deletionError);
		expect((failure as Error & { refreshError?: unknown }).refreshError).toMatchObject({ message: "refresh unavailable" });
		expect(refresh).toHaveBeenCalledOnce();
	});

	it("does not refresh after cancellation or an empty completed-task list", async () => {
		const refresh = vi.fn(async () => {});
		await expect(deleteCompletedTasksAndRefresh(async () => 0, refresh)).resolves.toBe(0);
		expect(refresh).not.toHaveBeenCalled();
	});
});

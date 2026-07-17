import { describe, expect, it } from "vitest";
import { buildTaskInputResult } from "../src/task-title-modal";

describe("task input result", () => {
	it("uses an explicit empty due date when an existing task date is cleared", () => {
		expect(buildTaskInputResult(" Task ", "", true)).toEqual({ title: "Task", dueDate: "" });
	});
	it("omits the due date when creating a task without one", () => {
		expect(buildTaskInputResult(" Task ", "", false)).toEqual({ title: "Task" });
	});
});

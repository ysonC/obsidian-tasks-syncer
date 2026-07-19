import { describe, expect, it, vi } from "vitest";
import { buildTaskInputResult, openNativeDatePicker, submitTaskFormOnEnter } from "../src/task-title-modal";

describe("task input result", () => {
	it("uses an explicit empty due date when an existing task date is cleared", () => {
		expect(buildTaskInputResult(" Task ", "", true)).toEqual({ title: "Task", dueDate: "" });
	});
	it("omits the due date when creating a task without one", () => {
		expect(buildTaskInputResult(" Task ", "", false)).toEqual({ title: "Task" });
	});
	it("omits an unchanged timed due date on title-only edits", () => {
		expect(buildTaskInputResult("New title", "2026-07-18", true, false)).toEqual({ title: "New title" });
	});
	it("distinguishes an explicitly cleared date", () => {
		expect(buildTaskInputResult("Task", "", true, true)).toEqual({ title: "Task", dueDate: "" });
	});
	it("rejects a blank title", () => {
		expect(() => buildTaskInputResult("   ", "", false)).toThrow(/title/i);
	});

	it("submits the task form when Enter is pressed in an input", () => {
		const preventDefault = vi.fn();
		const stopPropagation = vi.fn();
		const requestSubmit = vi.fn();
		const event = { key: "Enter", isComposing: false, preventDefault, stopPropagation } as unknown as KeyboardEvent;
		const submitter = {} as HTMLButtonElement;
		const form = { requestSubmit } as unknown as HTMLFormElement;

		submitTaskFormOnEnter(event, form, submitter);

		expect(preventDefault).toHaveBeenCalledOnce();
		expect(stopPropagation).toHaveBeenCalledOnce();
		expect(requestSubmit).toHaveBeenCalledWith(submitter);
	});

	it("does not submit while composing text or for other keys", () => {
		const requestSubmit = vi.fn();
		const form = { requestSubmit } as unknown as HTMLFormElement;
		const submitter = {} as HTMLButtonElement;
		submitTaskFormOnEnter({ key: "Enter", isComposing: true, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent, form, submitter);
		submitTaskFormOnEnter({ key: "Tab", isComposing: false, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent, form, submitter);

		expect(requestSubmit).not.toHaveBeenCalled();
	});

	it("opens the native date picker when available", () => {
		const showPicker = vi.fn();

		openNativeDatePicker({ showPicker } as unknown as HTMLInputElement);

		expect(showPicker).toHaveBeenCalledOnce();
	});

	it("keeps the date input usable when the native picker refuses to open", () => {
		expect(() => openNativeDatePicker({ showPicker: () => { throw new Error("NotAllowedError"); } } as unknown as HTMLInputElement)).not.toThrow();
	});
});

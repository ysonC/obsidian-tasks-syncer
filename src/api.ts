import { requestUrl } from "obsidian";
import { MyTodoSettings } from "src/setting";
import { TaskItem } from "./types";

/**
 * Fetches tasks from the selected Microsoft To‑Do list.
 * @param settings Plugin settings that contain the selected task list ID.
 * @param accessToken A valid access token.
 * @returns A map of task title to MSTask.
 */
export async function fetchTasks(
	settings: MyTodoSettings,
	accessToken: string,
): Promise<Map<string, TaskItem>> {
	const tasks = new Map<string, TaskItem>();
	const response = await requestUrl({
		url: `https://graph.microsoft.com/v1.0/me/todo/lists/${settings.selectedTaskListId}/tasks`,
		method: "GET",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Prefer: `outlook.timezone="GMT Standard Time"`,
		},
	});

	if (response.status !== 200) {
		throw new Error("Failed to fetch tasks: " + response.text);
	}

	const data = response.json;

	if (data.value && Array.isArray(data.value)) {
		for (const task of data.value) {
			const title = task.title.trim();
			tasks.set(title, {
				title,
				status: task.status,
				id: task.id,
				dueDateTime: task.dueDateTime,
			});
		}
	}
	return tasks;
}

/**
 * Creates a new task in Microsoft To‑Do.
 * @param settings Plugin settings containing the selected task list ID.
 * @param accessToken A valid access token.
 * @param taskTitle The title of the task to create.
 * @param dueDate Due date for the task, not required
 */
export async function createTask(
	settings: MyTodoSettings,
	accessToken: string,
	taskTitle: string,
	dueDate?: string,
): Promise<void> {
	const body: Record<string, any> = {
		title: taskTitle,
	};

	if (dueDate) {
		body.dueDateTime = {
			dateTime: dueDate,
			timeZone: "GMT Standard Time",
		};
	}

	const response = await requestUrl({
		url: `https://graph.microsoft.com/v1.0/me/todo/lists/${settings.selectedTaskListId}/tasks`,
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (response.status !== 201) {
		throw new Error(`Failed to create task: ${response.text}`);
	}
}

/**
 * Updates an existing task's status.
 * @param settings Plugin settings containing the selected task list ID.
 * @param accessToken A valid access token.
 * @param taskId The ID of the task to update.
 * @param status?    If provided, mark the task complete (`true`) or not (`false`).
 * @param title?     If provided, set the new title of the task.
 * @param dueDate?   If provided, set the due date/time as an ISO string (e.g. "2025-05-01T00:00:00").
 */
export async function updateTask(
	settings: MyTodoSettings,
	accessToken: string,
	taskId: string,
	title?: string,
	status?: boolean,
	dueDate?: string,
): Promise<void> {
	const body: {
		title?: string;
		status?: "completed" | "notStarted";
		dueDateTime?: { dateTime: string; timeZone: string };
	} = {};

	if (title !== undefined) {
		body.title = title;
	}

	if (status !== undefined) {
		body.status = status ? "completed" : "notStarted";
	}

	if (dueDate !== undefined) {
		body.dueDateTime = {
			dateTime: dueDate,
			timeZone: "GMT Standard Time",
		};
	}

	const response = await requestUrl({
		url: `https://graph.microsoft.com/v1.0/me/todo/lists/${settings.selectedTaskListId}/tasks/${taskId}`,
		method: "PATCH",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (response.status !== 200) {
		throw new Error(`Failed to update task: ${response.text}`);
	}
}

/**
 * Fetches the available Microsoft To‑Do task lists.
 * @param accessToken A valid access token.
 * @returns A map where each key is the task list title and the value is an object containing title, status (default), and id.
 */
export async function fetchTaskLists(
	accessToken: string,
): Promise<Array<{ title: string; id: string }>> {
	const response = await requestUrl({
		url: "https://graph.microsoft.com/v1.0/me/todo/lists",
		method: "GET",
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	if (response.status !== 200) {
		throw new Error("Failed to fetch task lists: " + response.text);
	}

	const data = response.json;
	const taskLists = new Array<{ title: string; id: string }>();

	console.log("Task lists data:", data);
	if (data.value && Array.isArray(data.value)) {
		for (const list of data.value) {
			let title = list.displayName;
			if (title === "工作") {
				title = "Tasks";
			}
			taskLists.push({ title, id: list.id });
		}
	}
	return taskLists;
}

/**
 * Deletes a task from Microsoft To‑Do.
 * @param settings Plugin settings containing the selected task list ID.
 * @param accessToken A valid access token.
 * @param taskId The ID of the task to delete.
 */
export async function deleteTask(
	settings: MyTodoSettings,
	accessToken: string,
	taskId: string,
): Promise<void> {
	const response = await requestUrl({
		url: `https://graph.microsoft.com/v1.0/me/todo/lists/${settings.selectedTaskListId}/tasks/${taskId}`,
		method: "DELETE",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
	});

	if (response.status !== 204) {
		throw new Error(`Failed to delete task: ${response.text}`);
	}
}

export async function updateTaskListName(
	settings: MyTodoSettings,
	accessToken: string,
	newName: string,
) {
	const endpoint = `https://graph.microsoft.com/v1.0/me/todo/lists/${settings.selectedTaskListId}`;
	const response = await fetch(endpoint, {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${accessToken}`,
		},
		body: JSON.stringify({
			displayName: newName,
		}),
	});

	if (!response.ok) {
		throw new Error(`Error updating list name: ${response.statusText}`);
	}

	return await response.json();
}

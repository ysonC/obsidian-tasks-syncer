import { requestUrl } from "obsidian";
import { MyTodoSettings } from "src/setting";

export interface MSTask {
	title: string;
	status: string;
	id: string;
}

/**
 * Fetches tasks from the selected Microsoft To‑Do list.
 * @param settings Plugin settings that contain the selected task list ID.
 * @param accessToken A valid access token.
 * @returns A map of task title to MSTask.
 */
export async function fetchTasks(
	settings: MyTodoSettings,
	accessToken: string
): Promise<Map<string, MSTask>> {
	const tasks = new Map<string, MSTask>();
	const response = await requestUrl({
		url: `https://graph.microsoft.com/v1.0/me/todo/lists/${settings.selectedTaskListId}/tasks`,
		method: "GET",
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	if (response.status !== 200) {
		throw new Error("Failed to fetch tasks: " + response.text);
	}

	const data = response.json;
	if (data.value && Array.isArray(data.value)) {
		for (const task of data.value) {
			const title = task.title.trim();
			tasks.set(title, { title, status: task.status, id: task.id });
		}
	}

	return tasks;
}

/**
 * Creates a new task in Microsoft To‑Do.
 * @param settings Plugin settings containing the selected task list ID.
 * @param accessToken A valid access token.
 * @param taskTitle The title of the task to create.
 * @param status Optional initial status ("completed" or "notStarted"). Defaults to "notStarted".
 */
export async function createTask(
	settings: MyTodoSettings,
	accessToken: string,
	taskTitle: string,
	status: string = "notStarted"
): Promise<void> {
	const response = await requestUrl({
		url: `https://graph.microsoft.com/v1.0/me/todo/lists/${settings.selectedTaskListId}/tasks`,
		method: "POST",
		headers: {
			"Authorization": `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			title: taskTitle,
			status: status,
		}),
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
 * @param complete Whether to mark the task as complete.
 */
export async function updateTask(
	settings: MyTodoSettings,
	accessToken: string,
	taskId: string,
	complete: boolean
): Promise<void> {
	const newStatus = complete ? "completed" : "notStarted";
	const response = await requestUrl({
		url: `https://graph.microsoft.com/v1.0/me/todo/lists/${settings.selectedTaskListId}/tasks/${taskId}`,
		method: "PATCH",
		headers: {
			"Authorization": `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ status: newStatus }),
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
	accessToken: string
): Promise<Map<string, { title: string, status: string, id: string }>> {
	const response = await requestUrl({
		url: "https://graph.microsoft.com/v1.0/me/todo/lists",
		method: "GET",
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	if (response.status !== 200) {
		throw new Error("Failed to fetch task lists: " + response.text);
	}

	const data = response.json;
	const taskLists = new Map<string, { title: string, status: string, id: string }>();

	if (data.value && Array.isArray(data.value)) {
		for (const list of data.value) {
			// Using list.displayName as the title, and setting a default status (empty string)
			taskLists.set(list.displayName, {
				title: list.displayName,
				status: "", // Default value since task lists don't include a status
				id: list.id
			});
		}
	}

	return taskLists;
}

import { requestUrl, RequestUrlParam } from "obsidian";
import TaskSyncerPlugin from "src/main";
import { TaskItem, TaskList } from "src/types";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TIMEZONE_HEADER = { Prefer: `outlook.timezone="GMT Standard Time"` };
type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface GraphResponse<T> {
	status: number;
	json: T;
	text: string;
}

/**
 * One-stop shop for Microsoft To-Do via Graph.
 */
export class MicrosoftTaskService {
	/**
	 * @param plugin The main plugin instance, used to get fresh tokens and settings.
	 */
	constructor(private plugin: TaskSyncerPlugin) { }

	/**
	 * Internal generic Graph request.
	 *
	 * @template T  The expected shape of the JSON response.
	 * @param path  The Graph API path (e.g. `/me/todo/lists/{listId}/tasks`). May include `{listId}`.
	 * @param method  HTTP method to use (`GET`, `POST`, `PATCH`, or `DELETE`).
	 * @param body  Optional request payload, which will be JSON-stringified if provided.
	 * @param extraHeaders  Any additional headers to merge into the request.
	 * @returns  A promise resolving to the raw Graph response (status, parsed JSON, and raw text).
	 * @throws  If no access token is available or if `path` requires a listId that isn’t set.
	 */
	private async request<T>(
		path: string,
		method: HttpMethod = "GET",
		body?: any,
		extraHeaders: Record<string, string> = {},
	): Promise<GraphResponse<T>> {
		const accessToken = await this.plugin.getAccessToken();
		const listId = this.plugin.settings.selectedTaskListId;
		if (!accessToken) throw new Error("Missing access token");
		if (path.includes("{listId}") && !listId) {
			throw new Error("Missing selectedTaskListId in settings");
		}

		const url = path.startsWith("http")
			? path
			: `${GRAPH_BASE}${path.replace("{listId}", listId)}`;

		const headers: Record<string, string> = {
			Authorization: `Bearer ${accessToken}`,
			...(body ? { "Content-Type": "application/json" } : {}),
			...extraHeaders,
		};

		const params: RequestUrlParam = { url, method, headers };
		if (body) params.body = JSON.stringify(body);

		return requestUrl(params) as Promise<GraphResponse<T>>;
	}

	/**
	 * Fetches all To-Do lists in the user’s mailbox.
	 *
	 * @returns  An array of task lists, each with an `id` and `title`.
	 * @throws  If the Graph call fails (non-200 status).
	 */
	async fetchTaskLists(): Promise<TaskList[]> {
		const res = await this.request<{ value: any[] }>(`/me/todo/lists`);
		if (res.status !== 200) {
			throw new Error(`Failed to fetch lists: ${res.text}`);
		}
		return (res.json.value || []).map((l) => {
			let title = l.displayName;
			if (title === "工作") title = "Tasks";
			return { id: l.id, title };
		});
	}

	/**
	 * Fetches all tasks in the currently selected list.
	 *
	 * @returns  A `Map` keyed by task title, with full `TaskItem` data.
	 * @throws  If no list is selected or the Graph call fails (non-200 status).
	 */
	async fetchTasks(): Promise<Map<string, TaskItem>> {
		const res = await this.request<{ value: any[] }>(
			`/me/todo/lists/{listId}/tasks`,
			"GET",
			undefined,
			TIMEZONE_HEADER,
		);
		if (res.status !== 200) {
			throw new Error(`Failed to fetch tasks: ${res.text}`);
		}
		const map = new Map<string, TaskItem>();
		for (const t of res.json.value || []) {
			const title = t.title.trim();
			map.set(title, {
				id: t.id,
				title,
				status: t.status,
				dueDateTime: t.dueDateTime,
			});
		}
		return map;
	}

	/**
	 * Creates a new task in the selected list.
	 *
	 * @param title  The title for the new task.
	 * @param dueDate  Optional ISO-8601 string for its due date (e.g. `"2025-05-01T10:00:00"`).
	 * @returns  A promise that resolves once the task is created.
	 * @throws  If no list is selected or the Graph call fails (non-201 status).
	 */
	async createTask(title: string, dueDate?: string): Promise<void> {
		const body: any = { title };
		if (dueDate) {
			body.dueDateTime = {
				dateTime: dueDate,
				timeZone: "GMT Standard Time",
			};
		}
		const res = await this.request<void>(
			`/me/todo/lists/{listId}/tasks`,
			"POST",
			body,
		);
		if (res.status !== 201) {
			throw new Error(`Failed to create task: ${res.text}`);
		}
	}

	/**
	 * Updates an existing task’s title, completion status, or due date.
	 *
	 * @param taskId  The Graph ID of the task to update.
	 * @param opts.title  If provided, the new title for the task.
	 * @param opts.status  If provided, `true` → mark complete; `false` → mark not started.
	 * @param opts.dueDate  If provided, an ISO-8601 string for the new due date.
	 * @returns  A promise that resolves once the task is updated.
	 * @throws  If no list is selected or the Graph call fails (non-200 status).
	 */
	async updateTask(
		taskId: string,
		opts: { title?: string; status?: boolean; dueDate?: string },
	): Promise<void> {
		const body: any = {};
		if (opts.title !== undefined) body.title = opts.title;
		if (opts.status !== undefined)
			body.status = opts.status ? "completed" : "notStarted";
		if (opts.dueDate !== undefined) {
			body.dueDateTime = {
				dateTime: opts.dueDate,
				timeZone: "GMT Standard Time",
			};
		}
		const res = await this.request<void>(
			`/me/todo/lists/{listId}/tasks/${taskId}`,
			"PATCH",
			body,
		);
		if (res.status !== 200) {
			throw new Error(`Failed to update task: ${res.text}`);
		}
	}

	/**
	 * Deletes a task from the selected list.
	 *
	 * @param taskId  The Graph ID of the task to delete.
	 * @returns  A promise that resolves once the task is deleted.
	 * @throws  If no list is selected or the Graph call fails (non-204 status).
	 */
	async deleteTask(taskId: string): Promise<void> {
		const res = await this.request<void>(
			`/me/todo/lists/{listId}/tasks/${taskId}`,
			"DELETE",
		);
		if (res.status !== 204) {
			throw new Error(`Failed to delete task: ${res.text}`);
		}
	}

	/**
	 * Renames the currently selected task list.
	 *
	 * @param newName  The new display name for the list.
	 * @returns  A promise that resolves once the list is renamed.
	 * @throws  If no list is selected or the Graph call fails (non-2xx status).
	 */
	async updateTaskListName(newName: string): Promise<void> {
		const res = await this.request<any>(
			`/me/todo/lists/{listId}`,
			"PATCH",
			{ displayName: newName },
		);
		if (res.status < 200 || res.status >= 300) {
			throw new Error(`Failed to rename list: ${res.text}`);
		}
	}
}

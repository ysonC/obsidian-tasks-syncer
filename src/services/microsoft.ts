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
	constructor(private plugin: TaskSyncerPlugin) { }

	/** Internal generic Graph request */
	private async request<T>(
		path: string,
		method: HttpMethod = "GET",
		body?: any,
		extraHeaders: Record<string, string> = {},
	): Promise<GraphResponse<T>> {
		// always re-fetch the token and the listId
		const accessToken = await this.plugin.getAccessToken();
		const listId = this.plugin.settings.selectedTaskListId;
		if (!accessToken) throw new Error("Missing access token");
		if (path.includes("{listId}") && !listId) {
			throw new Error("Missing selectedTaskListId in settings");
		}

		// substitute {listId} placeholder if you like, or just do it manually in callers
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

	/** List all To-Do lists in the user’s mailbox */
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

	/** Fetch all tasks in the selected list */
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

	/** Create a new task in the current list */
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

	/** Update title, completion status or due-date on a task */
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

	/** Delete a task by ID */
	async deleteTask(taskId: string): Promise<void> {
		const res = await this.request<void>(
			`/me/todo/lists/{listId}/tasks/${taskId}`,
			"DELETE",
		);
		if (res.status !== 204) {
			throw new Error(`Failed to delete task: ${res.text}`);
		}
	}

	/** Rename the current task list */
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

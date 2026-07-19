import { HttpClient, HttpRequest, HttpResponse } from "../http";
import { TaskItem, TaskList, TaskService, TaskUpdate } from "../types";

const BASE = "https://api.ticktick.com/open/v1";
type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);

export function formatTickTickDate(value: string): string {
	const date = value.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return `${date}T00:00:00+0000`;
	const noZone = date.replace(/Z$/, "+0000").replace(/([+-]\d{2}):(\d{2})$/, "$1$2");
	return /[+-]\d{4}$/.test(noZone) ? noZone : `${noZone}+0000`;
}

export class TickTickTaskService implements TaskService {
	readonly capabilities = { reopenTask: false };
	constructor(
		private readonly token: () => Promise<string>,
		private readonly http: HttpClient,
		private readonly timeZone: string,
		private readonly clearToken?: () => void | Promise<void>,
	) {}

	private async request<T = unknown>(path: string, method = "GET", body?: unknown): Promise<HttpResponse<T>> {
		const accessToken = await this.token();
		const request: HttpRequest = { url: `${BASE}${path}`, method, headers: { Authorization: "Bearer " + accessToken } };
		if (body !== undefined) {
			request.headers = { ...request.headers, "Content-Type": "application/json" };
			request.body = JSON.stringify(body);
		}
		const response = await this.http<T>(request);
		if (response.status < 200 || response.status >= 300) {
			if (response.status === 401 && this.clearToken) await this.clearToken();
			throw new Error(this.errorFor(response.status));
		}
		return response;
	}

	private errorFor(status: number): string {
		if (status === 401) return "TickTick session expired. Connect TickTick again.";
		if (status === 403) return "TickTick denied task permission. Verify tasks:read and tasks:write scopes.";
		if (status === 404) return "TickTick task or list was not found.";
		if (status === 429) return "TickTick rate limit reached. Try again later.";
		return `TickTick request failed (${status}).`;
	}

	private normalize(value: unknown, fallbackListId: string): TaskItem {
		if (!isRecord(value)) throw new Error("TickTick task response contains an invalid item.");
		const id = typeof value.id === "string" || typeof value.id === "number" ? String(value.id) : "";
		const title = typeof value.title === "string" ? value.title.trim() : "";
		if (!id || !title) throw new Error("TickTick task response is missing an ID or title.");
		return {
			id,
			listId: typeof value.projectId === "string" ? value.projectId : fallbackListId,
			title,
			status: Number(value.status) === 2 ? "completed" : "open",
			...(typeof value.dueDate === "string" ? { dueDate: value.dueDate } : {}),
		};
	}

	async fetchTaskLists(): Promise<TaskList[]> {
		const response = await this.request<unknown[]>("/project");
		if (!Array.isArray(response.json)) throw new Error("TickTick project response must be an array.");
		return response.json.map(value => {
			if (!isRecord(value) || (typeof value.id !== "string" && typeof value.id !== "number") || typeof value.name !== "string") {
				throw new Error("TickTick project response contains an invalid item.");
			}
			return { id: String(value.id), title: value.name.trim() };
		});
	}

	async fetchTasks(listId: string, includeCompleted = false): Promise<TaskItem[]> {
		const active = await this.request<unknown>(`/project/${encodeURIComponent(listId)}/data`);
		if (!isRecord(active.json) || !Array.isArray(active.json.tasks)) throw new Error("TickTick project data response is malformed.");
		const byId = new Map<string, TaskItem>();
		for (const value of active.json.tasks) { const task = this.normalize(value, listId); byId.set(task.id, task); }
		if (includeCompleted) {
			const completed = await this.request<unknown[]>("/task/completed", "POST", { projectIds: [listId] });
			if (!Array.isArray(completed.json)) throw new Error("TickTick completed-task response must be an array.");
			for (const value of completed.json) {
				const task = this.normalize(value, listId);
				const activeTask = byId.get(task.id);
				byId.set(task.id, activeTask ? { ...activeTask, status: "completed" } : task);
			}
		}
		return Array.from(byId.values());
	}

	private payload(listId: string, task: TaskUpdate): UnknownRecord {
		const body: UnknownRecord = { projectId: listId };
		if (task.title !== undefined) body.title = task.title;
		if (task.dueDate !== undefined) {
			body.dueDate = task.dueDate ? formatTickTickDate(task.dueDate) : null;
			if (task.dueDate) { body.timeZone = this.timeZone || "UTC"; body.isAllDay = true; }
		}
		return body;
	}

	async createTask(listId: string, task: TaskUpdate & { title: string }): Promise<TaskItem> {
		const response = await this.request<unknown>("/task", "POST", this.payload(listId, task));
		return this.normalize(response.json, listId);
	}
	async updateTask(listId: string, taskId: string, update: TaskUpdate): Promise<TaskItem> {
		const response = await this.request<unknown>(`/task/${encodeURIComponent(taskId)}`, "POST", { id: taskId, ...this.payload(listId, update) });
		return this.normalize(response.json, listId);
	}
	async completeTask(listId: string, taskId: string): Promise<void> { await this.request(`/project/${encodeURIComponent(listId)}/task/${encodeURIComponent(taskId)}/complete`, "POST"); }
	async deleteTask(listId: string, taskId: string): Promise<void> { await this.request(`/project/${encodeURIComponent(listId)}/task/${encodeURIComponent(taskId)}`, "DELETE"); }
}

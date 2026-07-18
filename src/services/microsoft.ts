import { HttpClient, HttpRequest, HttpResponse } from "../http";
import { TaskItem, TaskList, TaskService, TaskUpdate } from "../types";

const BASE = "https://graph.microsoft.com/v1.0";
const MAX_PAGES = 100;
type UnknownRecord = Record<string, unknown>;
interface GraphCollection { value: unknown[]; "@odata.nextLink"?: string; }

const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);
function requiredString(value: unknown, context: string): string {
	if (typeof value !== "string" || value.trim() === "") throw new Error(`Microsoft ${context} response is missing a valid string.`);
	return value;
}
function collection(value: unknown, context: string): GraphCollection {
	if (!isRecord(value) || !Array.isArray(value.value)) throw new Error(`Microsoft ${context} response must contain an array.`);
	const next = value["@odata.nextLink"];
	if (next !== undefined && typeof next !== "string") throw new Error(`Microsoft ${context} pagination next link is malformed.`);
	return { value: value.value, ...(typeof next === "string" ? { "@odata.nextLink": next } : {}) };
}
function safeNextLink(value: string): string {
	let url: URL;
	try { url = new URL(value); } catch { throw new Error("Microsoft pagination next link is malformed."); }
	if (url.origin !== new URL(BASE).origin || url.username || url.password) {
		throw new Error("Microsoft pagination next link must use the exact HTTPS graph.microsoft.com origin without credentials.");
	}
	return url.toString();
}

export class MicrosoftTaskService implements TaskService {
	readonly capabilities = { reopenTask: true };
	constructor(private readonly token: () => Promise<string>, private readonly http: HttpClient) {}

	private async request(pathOrUrl: string, method = "GET", body?: unknown): Promise<HttpResponse<unknown>> {
		const accessToken = await this.token();
		const request: HttpRequest = {
			url: pathOrUrl.startsWith("https://") ? pathOrUrl : `${BASE}${pathOrUrl}`,
			method,
			headers: { Authorization: `Bearer ${accessToken}`, Prefer: `outlook.timezone="UTC"` },
		};
		if (body !== undefined) { request.headers!["Content-Type"] = "application/json"; request.body = JSON.stringify(body); }
		const response = await this.http(request);
		if (response.status < 200 || response.status >= 300) throw new Error(this.errorFor(response.status));
		return response;
	}

	private errorFor(status: number): string {
		if (status === 401) return "Microsoft session expired. Connect Microsoft To Do again.";
		if (status === 403) return "Microsoft denied task permission.";
		if (status === 404) return "Microsoft task or list was not found.";
		if (status === 429) return "Microsoft rate limit reached. Try again later.";
		return `Microsoft request failed (${status}).`;
	}

	private async pages(path: string, context: string): Promise<unknown[]> {
		const output: unknown[] = [];
		const seen = new Set<string>();
		let next: string | undefined = path;
		for (let page = 0; next !== undefined; page++) {
			if (page >= MAX_PAGES) throw new Error(`Microsoft ${context} pagination exceeded ${MAX_PAGES} pages.`);
			const key = next.startsWith("https://") ? new URL(next).toString() : `${BASE}${next}`;
			if (seen.has(key)) throw new Error(`Microsoft ${context} pagination cycle detected.`);
			seen.add(key);
			const response = await this.request(next);
			const parsed = collection(response.json, context);
			output.push(...parsed.value);
			next = parsed["@odata.nextLink"] === undefined ? undefined : safeNextLink(parsed["@odata.nextLink"]);
		}
		return output;
	}

	async fetchTaskLists(): Promise<TaskList[]> {
		return (await this.pages("/me/todo/lists", "task lists")).map(raw => {
			if (!isRecord(raw)) throw new Error("Microsoft task lists response contains an invalid item.");
			return { id: requiredString(raw.id, "task list ID"), title: requiredString(raw.displayName, "task list title").trim() };
		});
	}

	async fetchTasks(listId: string, includeCompleted = true): Promise<TaskItem[]> {
		const filter = includeCompleted ? "" : "?$filter=status ne 'completed'";
		return (await this.pages(`/me/todo/lists/${encodeURIComponent(listId)}/tasks${filter}`, "tasks")).map(raw => this.normalizeTask(raw, listId));
	}

	private normalizeTask(value: unknown, listId: string, fallbackTitle?: string): TaskItem {
		if (!isRecord(value)) throw new Error("Microsoft tasks response contains an invalid item.");
		const due = isRecord(value.dueDateTime) && typeof value.dueDateTime.dateTime === "string" ? value.dueDateTime.dateTime : undefined;
		const title = typeof value.title === "string" && value.title.trim() ? value.title.trim() : fallbackTitle;
		if (!title) throw new Error("Microsoft task response is missing a valid title.");
		return {
			id: requiredString(value.id, "task ID"), listId, title,
			status: value.status === "completed" ? "completed" : "open",
			...(due ? { dueDate: due } : {}),
		};
	}

	async createTask(listId: string, task: TaskUpdate & { title: string }): Promise<TaskItem> {
		const body: UnknownRecord = { title: task.title };
		if (task.dueDate) body.dueDateTime = { dateTime: task.dueDate, timeZone: "UTC" };
		const response = await this.request(`/me/todo/lists/${encodeURIComponent(listId)}/tasks`, "POST", body);
		return this.normalizeTask(response.json, listId, task.title);
	}

	async updateTask(listId: string, taskId: string, update: TaskUpdate): Promise<TaskItem> {
		const body: UnknownRecord = {};
		if (update.title !== undefined) body.title = update.title;
		if (update.dueDate !== undefined) body.dueDateTime = update.dueDate ? { dateTime: update.dueDate, timeZone: "UTC" } : null;
		const response = await this.request(`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, "PATCH", body);
		if (!isRecord(response.json)) throw new Error("Microsoft task update response is malformed.");
		return this.normalizeTask({ id: taskId, ...response.json }, listId, update.title);
	}

	async completeTask(listId: string, taskId: string): Promise<void> { await this.request(`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, "PATCH", { status: "completed" }); }
	async reopenTask(listId: string, taskId: string): Promise<void> { await this.request(`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, "PATCH", { status: "notStarted" }); }
	async deleteTask(listId: string, taskId: string): Promise<void> { await this.request(`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, "DELETE"); }
}

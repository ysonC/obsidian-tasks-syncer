import { calendarDateInTimeZone } from "../date-only";
import { HttpClient, HttpRequest, HttpResponse } from "../http";
import { TaskItem, TaskList, TaskService, TaskUpdate } from "../types";

const BASE = "https://api.ticktick.com/open/v1";
type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);

function pad(value: number): string { return String(value).padStart(2, "0"); }

function formatUtcDate(date: Date): string {
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}+0000`;
}

function timeZoneOffsetMilliseconds(date: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", second: "2-digit",
		hour12: false,
	}).formatToParts(date);
	const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
	const hour = values.hour === 24 ? 0 : values.hour;
	return Date.UTC(values.year, values.month - 1, values.day, hour, values.minute, values.second) - date.getTime();
}

function localDateTimeToUtc(value: string, timeZone: string): Date {
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
	if (!match) return new Date(value);
	const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
	const wallClockTimestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
	let timestamp = wallClockTimestamp;
	for (let attempt = 0; attempt < 2; attempt++) {
		timestamp = wallClockTimestamp - timeZoneOffsetMilliseconds(new Date(timestamp), timeZone);
	}
	return new Date(timestamp);
}

function parseTickTickInstant(value: string): Date {
	return new Date(value.replace(/Z$/, "+0000").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

function normalizeTickTickDueDate(value: string, timeZone: string): string {
	const instant = parseTickTickInstant(value);
	if (Number.isNaN(instant.getTime())) return value;
	return calendarDateInTimeZone(instant, timeZone || "UTC");
}

export function formatTickTickDate(value: string, timeZone = "UTC"): string {
	const date = value.trim();
	const noZone = date.replace(/Z$/, "+0000").replace(/([+-]\d{2}):(\d{2})$/, "$1$2");
	if (/[+-]\d{4}$/.test(noZone)) return noZone;
	return formatUtcDate(localDateTimeToUtc(date, timeZone || "UTC"));
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
		const dueDate = typeof value.dueDate === "string"
			? normalizeTickTickDueDate(value.dueDate, typeof value.timeZone === "string" ? value.timeZone : this.timeZone)
			: undefined;
		return {
			id,
			listId: typeof value.projectId === "string" ? value.projectId : fallbackListId,
			title,
			status: Number(value.status) === 2 ? "completed" : "open",
			...(dueDate ? { dueDate } : {}),
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
			body.dueDate = task.dueDate ? formatTickTickDate(task.dueDate, this.timeZone || "UTC") : null;
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

import { HttpClient, HttpRequest, HttpResponse } from "../http";
import { TaskItem, TaskList, TaskService, TaskUpdate } from "../types";

const BASE = "https://graph.microsoft.com/v1.0";
export class MicrosoftTaskService implements TaskService {
	readonly capabilities = { reopenTask: true, renameTaskList: true };
	constructor(private token: () => Promise<string>, private http: HttpClient) {}
	private async request<T>(path: string, method = "GET", body?: any): Promise<HttpResponse<T>> {
		const accessToken = await this.token(); const request: HttpRequest = { url: `${BASE}${path}`, method, headers: { Authorization: `Bearer ${accessToken}`, Prefer: `outlook.timezone="UTC"` } };
		if (body !== undefined) { request.headers!["Content-Type"] = "application/json"; request.body = JSON.stringify(body); }
		const res = await this.http<T>(request); if (res.status < 200 || res.status >= 300) throw new Error(this.errorFor(res.status)); return res;
	}
	private errorFor(status: number) { if (status === 401) return "Microsoft session expired. Connect Microsoft To Do again."; if (status === 403) return "Microsoft denied task permission."; if (status === 404) return "Microsoft task or list was not found."; if (status === 429) return "Microsoft rate limit reached. Try again later."; return `Microsoft request failed (${status}).`; }
	async fetchTaskLists(): Promise<TaskList[]> { const res = await this.request<{ value: any[] }>("/me/todo/lists"); return (res.json.value || []).map(l => ({ id: l.id, title: String(l.displayName || "").trim() })); }
	async fetchTasks(listId: string, includeCompleted = true): Promise<TaskItem[]> { const filter = includeCompleted ? "" : "?$filter=status ne 'completed'"; const res = await this.request<{ value: any[] }>(`/me/todo/lists/${encodeURIComponent(listId)}/tasks${filter}`); return (res.json.value || []).map(t => ({ id: t.id, listId, title: String(t.title || "").trim(), status: t.status === "completed" ? "completed" : "open", ...(t.dueDateTime?.dateTime ? { dueDate: t.dueDateTime.dateTime } : {}) })); }
	async createTask(listId: string, task: TaskUpdate & { title: string }): Promise<TaskItem> { const body: any = { title: task.title }; if (task.dueDate) body.dueDateTime = { dateTime: task.dueDate, timeZone: "UTC" }; const res = await this.request<any>(`/me/todo/lists/${encodeURIComponent(listId)}/tasks`, "POST", body); return { id: res.json.id, listId, title: res.json.title || task.title, status: res.json.status === "completed" ? "completed" : "open", ...(res.json.dueDateTime?.dateTime ? { dueDate: res.json.dueDateTime.dateTime } : task.dueDate ? { dueDate: task.dueDate } : {}) }; }
	async updateTask(listId: string, taskId: string, update: TaskUpdate): Promise<TaskItem> { const body: any = { ...update }; if (update.dueDate !== undefined) { delete body.dueDate; body.dueDateTime = update.dueDate ? { dateTime: update.dueDate, timeZone: "UTC" } : null; } const res = await this.request<any>(`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, "PATCH", body); return { id: taskId, listId, title: res.json.title || update.title || "", status: res.json.status === "completed" ? "completed" : "open", ...(res.json.dueDateTime?.dateTime ? { dueDate: res.json.dueDateTime.dateTime } : {}) }; }
	async completeTask(listId: string, taskId: string) { await this.request(`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, "PATCH", { status: "completed" }); }
	async reopenTask(listId: string, taskId: string) { await this.request(`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, "PATCH", { status: "notStarted" }); }
	async deleteTask(listId: string, taskId: string) { await this.request(`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, "DELETE"); }
	async renameTaskList(listId: string, title: string) { await this.request(`/me/todo/lists/${encodeURIComponent(listId)}`, "PATCH", { displayName: title }); }
}

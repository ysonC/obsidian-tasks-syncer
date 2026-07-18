import type { TaskStatus } from "./types";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function calendarDateInTimeZone(now: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
	const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
	return `${value("year")}-${value("month")}-${value("day")}`;
}

export function addCalendarDays(value: string, days: number): string {
	if (!DATE_ONLY.test(value)) throw new Error("Invalid calendar date.");
	const [year, month, day] = value.split("-").map(Number);
	const date = new Date(Date.UTC(year, month - 1, day + days));
	return date.toISOString().slice(0, 10);
}

export function dueDateLabel(date: string, status: TaskStatus, today: string): string {
	if (status === "completed" || !date) return date;
	if (date === today) return "Today";
	if (date === addCalendarDays(today, 1)) return "Tomorrow";
	return date < today ? "Past due" : date;
}

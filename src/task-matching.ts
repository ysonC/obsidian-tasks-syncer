import type { TaskItem } from "./types";

export function normalizedTitle(title: string): string {
	return title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export type TaskMatch =
	| { status: "none" }
	| { status: "matched"; task: TaskItem }
	| { status: "ambiguous"; matches: number };

/** Title matching is only a duplicate guard; ambiguous remote identity fails closed. */
export function matchRemoteTask(tasks: readonly TaskItem[], title: string): TaskMatch {
	const key = normalizedTitle(title);
	const matches = tasks.filter(task => normalizedTitle(task.title) === key);
	if (matches.length === 0) return { status: "none" };
	if (matches.length > 1) return { status: "ambiguous", matches: matches.length };
	return { status: "matched", task: matches[0] };
}

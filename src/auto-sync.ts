export interface AutoSyncTimers {
	setInterval(callback: () => void, milliseconds: number): number;
	clearInterval(id: number): void;
}

const browserTimers: AutoSyncTimers = {
	setInterval: (callback, milliseconds) => window.setInterval(callback, milliseconds),
	clearInterval: id => window.clearInterval(id),
};

export function minutesToMilliseconds(minutes: number): number {
	return minutes * 60 * 1000;
}

/** Runs remote task refreshes on a configurable interval without overlap. */
export class AutoSyncController {
	private intervalId?: number;
	private running = false;

	constructor(
		private sync: () => Promise<void>,
		private canSync: () => boolean,
		private reportError: (error: unknown) => void,
		private timers: AutoSyncTimers = browserTimers,
	) {}

	configure(intervalMinutes: number): void {
		this.stop();
		if (intervalMinutes <= 0) return;
		this.intervalId = this.timers.setInterval(
			() => { void this.run(); },
			minutesToMilliseconds(intervalMinutes),
		);
	}

	async run(): Promise<boolean> {
		if (this.running || !this.canSync()) return false;
		this.running = true;
		try {
			await this.sync();
			return true;
		} catch (error) {
			this.reportError(error);
			return false;
		} finally {
			this.running = false;
		}
	}

	stop(): void {
		if (this.intervalId === undefined) return;
		this.timers.clearInterval(this.intervalId);
		this.intervalId = undefined;
	}
}

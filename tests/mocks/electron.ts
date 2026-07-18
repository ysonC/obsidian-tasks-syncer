import { EventEmitter } from "events";

class MockWebContents extends EventEmitter {
	setWindowOpenHandler(_handler: () => { action: "deny" }): void {}
}

export class BrowserWindow extends EventEmitter {
	readonly webContents = new MockWebContents();
	private destroyed = false;
	constructor(public readonly options?: unknown) { super(); }
	async loadURL(_url: string): Promise<void> {}
	isDestroyed(): boolean { return this.destroyed; }
	close(): void { this.destroyed = true; this.emit("closed"); }
}

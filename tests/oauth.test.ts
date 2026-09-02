import { describe, expect, it, vi } from "vitest";
import { BrowserWindow } from "@electron/remote";
import { get } from "http";
import { createServer } from "net";
import { setTimeout as delay } from "timers/promises";
import { isExactRedirect, openOAuthWindow } from "../src/auth/oauth";

vi.mock("@electron/remote", () => ({ BrowserWindow: vi.fn() }));

async function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() => {
				if (address && typeof address === "object") resolve(address.port);
				else reject(new Error("Unable to allocate test port."));
			});
		});
	});
}

async function waitForGet(url: string): Promise<string> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 20; attempt++) {
		try {
			return await new Promise((resolve, reject) => {
				get(url, response => {
					let body = "";
					response.setEncoding("utf8");
					response.on("data", chunk => { body += chunk; });
					response.on("end", () => resolve(body));
				}).on("error", reject);
			});
		} catch (error) {
			lastError = error;
			await delay(25);
		}
	}
	throw lastError;
}

describe("OAuth browser authorization", () => {
	it("requires configured redirect query parameters to match", () => {
		expect(isExactRedirect("http://localhost:5000/callback?tenant=other&code=x", "http://localhost:5000/callback?tenant=personal")).toBe(false);
		expect(isExactRedirect("http://localhost:5000/callback?tenant=personal&code=x", "http://localhost:5000/callback?tenant=personal")).toBe(true);
		expect(isExactRedirect("http://localhost:5000/callback?tenant=personal&extra=value&code=x&state=s", "http://localhost:5000/callback?tenant=personal")).toBe(false);
		expect(isExactRedirect("http://localhost:5000/callback?tenant=personal&code=x&state=s&client_info=abc&clientdata=m%7C%7C%7Cmicrosoftonline.com%7Cnone", "http://localhost:5000/callback?tenant=personal")).toBe(true);
		expect(isExactRedirect("http://localhost:5000/callback?tenant=personal&code=x&state=s&error_description=nope", "http://localhost:5000/callback?tenant=personal")).toBe(true);
		expect(isExactRedirect("http://localhost:5000/callback?tenant=personal&code=x", "http://localhost:5000/callback?tenant=personal&tenant=personal")).toBe(false);
	});
	it("rejects a malformed redirect before creating a browser window", async () => {
		await expect(openOAuthWindow("https://login.example/authorize", "not a URL")).rejects.toThrow(/invalid.*redirect/i);
		expect(BrowserWindow).not.toHaveBeenCalled();
	});

	it("rejects an already-aborted authorization before creating a browser window", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(openOAuthWindow("https://login.example/authorize", "http://localhost:5000", controller.signal)).rejects.toThrow(/abort/i);
		expect(BrowserWindow).not.toHaveBeenCalled();
	});

	it("closes the window and removes every listener when authorization is aborted", async () => {
		const handlers = new Map<string, (...args: any[]) => void>();
		const removeWebListener = vi.fn();
		const removeWindowListener = vi.fn();
		const close = vi.fn();
		vi.mocked(BrowserWindow).mockImplementationOnce(function BrowserWindowMock() {
			return {
				webContents: {
					on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
					removeListener: removeWebListener,
					setWindowOpenHandler: vi.fn(),
				},
				on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
				removeListener: removeWindowListener,
				loadURL: vi.fn(async () => {}),
				isDestroyed: () => false,
				close,
			} as any;
		});
		const controller = new AbortController();
		const removeAbortListener = vi.spyOn(controller.signal, "removeEventListener");
		const authorization = openOAuthWindow("https://login.example/authorize", "http://localhost:5000", controller.signal);
		controller.abort();
		await expect(authorization).rejects.toThrow(/abort/i);
		expect(close).toHaveBeenCalledOnce();
		expect(removeWebListener).toHaveBeenCalledWith("will-redirect", handlers.get("will-redirect"));
		expect(removeWebListener).toHaveBeenCalledWith("will-navigate", handlers.get("will-navigate"));
		expect(removeWindowListener).toHaveBeenCalledWith("closed", handlers.get("closed"));
		expect(removeAbortListener).toHaveBeenCalledWith("abort", expect.any(Function));
		expect(() => handlers.get("will-navigate")?.({ preventDefault: vi.fn() }, "http://localhost:5000?code=late")).not.toThrow();
		expect(close).toHaveBeenCalledOnce();
	});

	it("keeps provider popups inside the OAuth window, uses unique ephemeral partitions, and waits for fixed redirect query values", async () => {
		const windows: Array<{ handlers: Map<string, (...args: any[]) => void>; close: ReturnType<typeof vi.fn>; loadURL: ReturnType<typeof vi.fn>; popupHandler?: (details: { url: string }) => unknown; removeWebListener: ReturnType<typeof vi.fn>; removeWindowListener: ReturnType<typeof vi.fn> }> = [];
		vi.mocked(BrowserWindow).mockImplementation(function BrowserWindowMock() {
			const handlers = new Map<string, (...args: any[]) => void>();
			const entry: typeof windows[number] = { handlers, close: vi.fn(), loadURL: vi.fn(async () => {}), removeWebListener: vi.fn(), removeWindowListener: vi.fn() };
			windows.push(entry);
			return {
				webContents: {
					on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
					removeListener: entry.removeWebListener,
					setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => unknown) => { entry.popupHandler = handler; }),
				},
				on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
				removeListener: entry.removeWindowListener,
				loadURL: entry.loadURL,
				isDestroyed: () => false,
				close: entry.close,
			} as any;
		});
		const first = openOAuthWindow("https://login.example/one", "http://localhost:5000/callback?tenant=personal");
		expect(windows[0].loadURL).toHaveBeenCalledWith("https://login.example/one");
		expect(windows[0].popupHandler?.({ url: "https://ticktick.com/signin?continue=oauth" })).toEqual({ action: "deny" });
		expect(windows[0].loadURL).toHaveBeenCalledWith("https://ticktick.com/signin?continue=oauth");
		windows[0].handlers.get("will-navigate")?.({ preventDefault: vi.fn() }, "http://localhost:5000/callback?tenant=other&code=wrong");
		expect(windows[0].close).not.toHaveBeenCalled();
		windows[0].handlers.get("will-redirect")?.({ preventDefault: vi.fn() }, "http://localhost:5000/callback?tenant=personal&code=one");
		await expect(first).resolves.toContain("code=one");

		const second = openOAuthWindow("https://login.example/two", "http://localhost:5000/callback?tenant=personal");
		windows[1].handlers.get("will-navigate")?.({ preventDefault: vi.fn() }, "http://localhost:5000/callback?tenant=personal&code=two");
		await expect(second).resolves.toContain("code=two");
		const partitions = vi.mocked(BrowserWindow).mock.calls.map(([options]: any[]) => options.webPreferences.partition as string);
		expect(partitions).toHaveLength(2);
		expect(partitions[0]).not.toBe(partitions[1]);
		for (const partition of partitions) {
			expect(partition).toMatch(/^task-syncer-oauth-[0-9a-f]{32}$/);
			expect(partition).not.toContain("persist:");
		}
		for (const entry of windows) {
			expect(entry.removeWebListener).toHaveBeenCalledTimes(2);
			expect(entry.removeWindowListener).toHaveBeenCalledOnce();
		}
	});

	it("captures loopback redirects from the system browser", async () => {
		const port = await getFreePort();
		const redirectUrl = `http://127.0.0.1:${port}/callback?tenant=personal`;
		const close = vi.fn();
		vi.mocked(BrowserWindow).mockImplementationOnce(function BrowserWindowMock() {
			return {
				webContents: {
					on: vi.fn(),
					removeListener: vi.fn(),
					setWindowOpenHandler: vi.fn(),
				},
				on: vi.fn(),
				removeListener: vi.fn(),
				loadURL: vi.fn(async () => {}),
				isDestroyed: () => false,
				close,
			} as any;
		});

		const authorization = openOAuthWindow("https://login.example/authorize", redirectUrl);
		const body = await waitForGet(`${redirectUrl}&code=external&state=expected`);

		expect(body).toContain("You can return to Obsidian");
		await expect(authorization).resolves.toContain("code=external");
		expect(close).toHaveBeenCalledOnce();
	});

	it("closes and rejects when navigation supplies a malformed URL", async () => {
		const handlers = new Map<string, (...args: any[]) => void>();
		const close = vi.fn();
		vi.mocked(BrowserWindow).mockImplementationOnce(function BrowserWindowMock() {
			return {
				webContents: {
					on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
					removeListener: vi.fn(),
					setWindowOpenHandler: vi.fn(),
				},
				on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
				removeListener: vi.fn(),
				loadURL: vi.fn(async () => {}),
				isDestroyed: () => false,
				close,
			} as any;
		});
		const authorization = openOAuthWindow("https://login.example/authorize", "http://localhost:5000");
		expect(() => handlers.get("will-navigate")?.({}, "not a URL")).not.toThrow();
		await expect(authorization).rejects.toThrow(/invalid url/i);
		expect(close).toHaveBeenCalledOnce();
	});

});

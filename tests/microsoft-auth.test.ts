import { describe, expect, it, vi } from "vitest";
import { BrowserWindow } from "@electron/remote";
import { isExactRedirect, MicrosoftAuthProvider, openOAuthWindow } from "../src/auth/microsoft";

vi.mock("@electron/remote", () => ({ BrowserWindow: vi.fn() }));

class MemoryStore {
	value = "";
	read = vi.fn(async () => this.value);
	write = vi.fn(async (value: string) => { this.value = value; });
	remove = vi.fn(async () => { this.value = ""; });
}

function setup(callbackState: string | undefined) {
	const cache = {
		deserialize: vi.fn(), serialize: vi.fn(() => "cache"),
		getAllAccounts: vi.fn(async () => []), removeAccount: vi.fn(),
	};
	const client = {
		getTokenCache: () => cache,
		getAuthCodeUrl: vi.fn(async () => "https://login.example/authorize"),
		acquireTokenByCode: vi.fn(async () => ({ accessToken: "access" })),
		acquireTokenSilent: vi.fn(),
	};
	const callback = new URL("http://localhost:5000");
	callback.searchParams.set("code", "code");
	if (callbackState !== undefined) callback.searchParams.set("state", callbackState);
	const auth = new MicrosoftAuthProvider(
		{ clientId: "id", clientSecret: "secret", redirectUrl: "http://localhost:5000" },
		new MemoryStore(),
		{ client: client as any, authorize: async () => callback.toString(), createState: () => "expected-state" },
	);
	return { auth, client };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

describe("Microsoft OAuth state", () => {
	it("requires configured redirect query parameters to match", () => {
		expect(isExactRedirect("http://localhost:5000/callback?tenant=other&code=x", "http://localhost:5000/callback?tenant=personal")).toBe(false);
		expect(isExactRedirect("http://localhost:5000/callback?tenant=personal&code=x", "http://localhost:5000/callback?tenant=personal")).toBe(true);
		expect(isExactRedirect("http://localhost:5000/callback?tenant=personal&extra=value&code=x&state=s", "http://localhost:5000/callback?tenant=personal")).toBe(false);
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

	it("denies popups, uses unique ephemeral partitions, and waits for fixed redirect query values", async () => {
		const windows: Array<{ handlers: Map<string, (...args: any[]) => void>; close: ReturnType<typeof vi.fn>; removeWebListener: ReturnType<typeof vi.fn>; removeWindowListener: ReturnType<typeof vi.fn> }> = [];
		vi.mocked(BrowserWindow).mockImplementation(function BrowserWindowMock() {
			const handlers = new Map<string, (...args: any[]) => void>();
			const entry = { handlers, close: vi.fn(), removeWebListener: vi.fn(), removeWindowListener: vi.fn() };
			windows.push(entry);
			return {
				webContents: {
					on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
					removeListener: entry.removeWebListener,
					setWindowOpenHandler: vi.fn((handler: () => unknown) => { expect(handler()).toEqual({ action: "deny" }); }),
				},
				on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
				removeListener: entry.removeWindowListener,
				loadURL: vi.fn(async () => {}),
				isDestroyed: () => false,
				close: entry.close,
			} as any;
		});
		const first = openOAuthWindow("https://login.example/one", "http://localhost:5000/callback?tenant=personal");
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

	it("includes generated state and accepts its exact return", async () => {
		const { auth, client } = setup("expected-state");
		await expect(auth.login()).resolves.toBe("access");
		expect(client.getAuthCodeUrl).toHaveBeenCalledWith(expect.objectContaining({ state: "expected-state" }));
		expect(client.acquireTokenByCode).toHaveBeenCalledOnce();
	});

	it.each([undefined, "wrong-state"])("rejects %s returned state before code exchange", async returnedState => {
		const { auth, client } = setup(returnedState);
		await expect(auth.login()).rejects.toThrow("state");
		expect(client.acquireTokenByCode).not.toHaveBeenCalled();
	});

	it("rejects an injected off-origin callback before code exchange", async () => {
		const { auth, client } = setup("expected-state");
		client.getAuthCodeUrl.mockResolvedValue("https://login.example/authorize");
		(auth as any).authorize = async () => "https://evil.example/callback?code=code&state=expected-state";
		await expect(auth.login()).rejects.toThrow(/redirect/i);
		expect(client.acquireTokenByCode).not.toHaveBeenCalled();
	});

	it("does not persist a token when unloading aborts during code exchange", async () => {
		const exchange = deferred<{ accessToken: string }>();
		const store = new MemoryStore();
		const cache = {
			deserialize: vi.fn(), serialize: vi.fn(() => "cache"),
			getAllAccounts: vi.fn(async () => []), removeAccount: vi.fn(),
		};
		const client = {
			getTokenCache: () => cache,
			getAuthCodeUrl: vi.fn(async () => "https://login.example/authorize"),
			acquireTokenByCode: vi.fn(() => exchange.promise),
			acquireTokenSilent: vi.fn(),
		};
		const controller = new AbortController();
		const authorize = vi.fn(async (_url: string, redirect: string, signal?: AbortSignal) => {
			expect(signal).toBe(controller.signal);
			return `${redirect}?code=code&state=expected-state`;
		});
		const auth = new MicrosoftAuthProvider(
			{ clientId: "id", clientSecret: "secret", redirectUrl: "http://localhost:5000" },
			store,
			{ client: client as any, authorize, createState: () => "expected-state", signal: controller.signal },
		);
		const login = auth.login();
		await vi.waitFor(() => expect(client.acquireTokenByCode).toHaveBeenCalledOnce());
		controller.abort();
		exchange.resolve({ accessToken: "access" });
		await expect(login).rejects.toThrow(/abort/i);
		expect(store.write).not.toHaveBeenCalled();
	});
});

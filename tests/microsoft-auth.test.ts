import { describe, expect, it, vi } from "vitest";
import { BrowserWindow } from "@electron/remote";
import { MicrosoftAuthProvider, openOAuthWindow } from "../src/auth/microsoft";

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

describe("Microsoft OAuth state", () => {
	it("rejects a malformed redirect before creating a browser window", async () => {
		await expect(openOAuthWindow("https://login.example/authorize", "not a URL")).rejects.toThrow(/invalid.*redirect/i);
		expect(BrowserWindow).not.toHaveBeenCalled();
	});

	it("closes and rejects when navigation supplies a malformed URL", async () => {
		const handlers = new Map<string, (...args: any[]) => void>();
		const close = vi.fn();
		vi.mocked(BrowserWindow).mockImplementationOnce(() => ({
			webContents: { on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler) },
			on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
			loadURL: vi.fn(async () => {}),
			isDestroyed: () => false,
			close,
		}) as any);
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
});

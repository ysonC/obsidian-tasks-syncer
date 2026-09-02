import { describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { MicrosoftAuthProvider, ObsidianMsalNetworkClient } from "../src/auth/microsoft";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

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
	it("redeems MSAL network requests through Obsidian requestUrl without browser origin", async () => {
		vi.mocked(requestUrl).mockResolvedValueOnce({
			status: 200,
			headers: { "content-type": "application/json" },
			arrayBuffer: new ArrayBuffer(0),
			json: { access_token: "access" },
			text: '{"access_token":"access"}',
		});
		const client = new ObsidianMsalNetworkClient();

		await expect(client.sendPostRequestAsync<{ access_token: string }>(
			"https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
			{
				body: "grant_type=authorization_code&code=code",
				headers: {
					Origin: "app://obsidian.md",
					"Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
				},
			},
		)).resolves.toEqual({
			status: 200,
			headers: { "content-type": "application/json" },
			body: { access_token: "access" },
		});
		expect(requestUrl).toHaveBeenCalledWith({
			url: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
			contentType: "application/x-www-form-urlencoded;charset=utf-8",
			body: "grant_type=authorization_code&code=code",
			throw: false,
		});
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

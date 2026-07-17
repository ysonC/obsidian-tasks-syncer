import { describe, expect, it, vi } from "vitest";
import { MicrosoftAuthProvider } from "../src/auth/microsoft";

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

import { describe, expect, it, vi } from "vitest";
import { TickTickAuthProvider, buildTickTickAuthorizationUrl } from "../src/auth/ticktick";

class MemoryStore {
	value = "";
	read = vi.fn(async () => this.value);
	write = vi.fn(async (v: string) => { this.value = v; });
	remove = vi.fn(async () => { this.value = ""; });
}

describe("TickTick OAuth", () => {
	it("builds official authorization URL with exact redirect, required scopes, and state", () => {
		const url = new URL(buildTickTickAuthorizationUrl("client", "obsidian://ticktick/callback", "state-123"));
		expect(url.origin + url.pathname).toBe("https://ticktick.com/oauth/authorize");
		expect(url.searchParams.get("scope")).toBe("tasks:read tasks:write");
		expect(url.searchParams.get("redirect_uri")).toBe("obsidian://ticktick/callback");
		expect(url.searchParams.get("state")).toBe("state-123");
	});

	it("strictly validates state and redirect before token exchange", async () => {
		const store = new MemoryStore(); const exchange = vi.fn();
		const auth = new TickTickAuthProvider({ clientId: "id", clientSecret: "secret", redirectUrl: "obsidian://ticktick/callback" }, store, exchange as any, async (_url: string, redirect: string) => `${redirect}?code=abc&state=wrong`, () => "expected");
		await expect(auth.login()).rejects.toThrow("state"); expect(exchange).not.toHaveBeenCalled();
	});

	it("exchanges an authorization code using form encoding and Basic auth and caches no assumed refresh token", async () => {
		const store = new MemoryStore();
		const exchange = vi.fn(async (req: any) => ({ status: 200, json: { access_token: "access", expires_in: 3600 }, text: "" }));
		const auth = new TickTickAuthProvider({ clientId: "id", clientSecret: "secret", redirectUrl: "obsidian://ticktick/callback" }, store, exchange as any, async (_url: string, redirect: string) => `${redirect}?code=a%20b&state=s`, () => "s");
		await expect(auth.login()).resolves.toBe("access");
		const req = exchange.mock.calls[0][0];
		expect(req.url).toBe("https://ticktick.com/oauth/token");
		expect(req.headers.Authorization).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
		expect(req.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
		expect(req.body).toContain("code=a+b"); expect(store.value).not.toContain("refresh");
		await expect(auth.isAuthenticated()).resolves.toBe(true);
		await auth.logout(); expect(store.remove).toHaveBeenCalled();
	});
});

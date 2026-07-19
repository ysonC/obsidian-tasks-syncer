import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock("obsidian", () => ({ requestUrl: mocks.requestUrl }));

import { obsidianHttpClient } from "../src/provider";

describe("obsidianHttpClient", () => {
	it("does not parse JSON for empty successful responses", async () => {
		mocks.requestUrl.mockResolvedValueOnce({
			status: 204,
			text: "",
			get json() {
				throw new SyntaxError("Unexpected end of JSON input");
			},
		});

		await expect(obsidianHttpClient({ url: "https://example.test/tasks/1", method: "PATCH" }))
			.resolves.toEqual({ status: 204, json: undefined, text: "" });
	});
});

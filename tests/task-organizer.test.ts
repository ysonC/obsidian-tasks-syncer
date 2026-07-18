import { describe, expect, it } from "vitest";
import { GENERATED_END, GENERATED_START, updateManagedTaskSection } from "../src/task-organizer";

describe("managed organized task output", () => {
	it("preserves frontmatter, headings, and prose outside its markers", () => {
		const original = `---\ntag: personal\n---\n# My tasks\nKeep this prose.\n\n${GENERATED_START}\nold\n${GENERATED_END}\n\nFooter.`;
		const updated = updateManagedTaskSection(original, "- [ ] New");
		expect(updated).toContain("---\ntag: personal\n---");
		expect(updated).toContain("Keep this prose.");
		expect(updated).toContain("Footer.");
		expect(updated).toContain(`${GENERATED_START}\n- [ ] New\n${GENERATED_END}`);
		expect(updated).not.toContain("old");
	});
	it("appends an owned section when no markers exist", () => {
		expect(updateManagedTaskSection("# Existing\n\nText", "- [x] Done")).toBe(`# Existing\n\nText\n\n${GENERATED_START}\n- [x] Done\n${GENERATED_END}\n`);
	});
	it("preserves trailing whitespace when appending the first owned section", () => {
		const original = "# Existing\n\nText  \n \n";
		expect(updateManagedTaskSection(original, "- [ ] New").startsWith(original)).toBe(true);
	});
	it("fails closed when markers are corrupt or duplicated", () => {
		expect(() => updateManagedTaskSection(`${GENERATED_START}\nold`, "new")).toThrow(/marker/i);
		expect(() => updateManagedTaskSection(`${GENERATED_END}`, "new")).toThrow(/marker/i);
		expect(() => updateManagedTaskSection(`${GENERATED_START}\none\n${GENERATED_END}\n${GENERATED_START}\ntwo\n${GENERATED_END}`, "new")).toThrow(/marker/i);
	});
});

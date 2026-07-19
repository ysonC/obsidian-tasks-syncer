import { describe, expect, it } from "vitest";
import { addCalendarDays, calendarDateInTimeZone, dueDateLabel } from "../src/date-only";

describe("calendar date helpers", () => {
	it("uses the configured calendar zone rather than UTC", () => {
		const instant = new Date("2026-07-18T02:00:00Z");
		expect(calendarDateInTimeZone(instant, "America/Los_Angeles")).toBe("2026-07-17");
		expect(calendarDateInTimeZone(instant, "Asia/Shanghai")).toBe("2026-07-18");
	});
	it("crosses month and year boundaries without UTC label drift", () => {
		expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
		expect(dueDateLabel("2027-01-01", "open", "2026-12-31")).toBe("Tomorrow");
		expect(dueDateLabel("2026-12-30", "open", "2026-12-31")).toBe("Past due");
	});
});

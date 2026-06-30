import { expect, test } from "bun:test";
import {
	LIVE_BUILTIN_TOOL_NAMES,
	LIVE_CUSTOM_TOOL_NAMES,
	LIVE_SESSION_TOOL_NAMES,
} from "../src/pi-runtime";

test("exposes live custom tools alongside built-in tools", () => {
	expect(LIVE_SESSION_TOOL_NAMES).toEqual([
		...LIVE_BUILTIN_TOOL_NAMES,
		...LIVE_CUSTOM_TOOL_NAMES,
	]);
	expect(LIVE_SESSION_TOOL_NAMES).toContain("send_message");
	expect(LIVE_SESSION_TOOL_NAMES).toContain("ask_user");
	expect(LIVE_SESSION_TOOL_NAMES).toContain("refresh_thread");
});

import { expect, test } from "bun:test";
import { buildChunkedTextResult, buildThreadState } from "../src/ai-tools";

test("chunked text results expose offset metadata for large content", () => {
	const result = buildChunkedTextResult("x".repeat(12000), 4000, {
		label: "/workspace/large-test.txt",
	});

	expect(typeof result).toBe("object");
	expect(result).toMatchObject({
		kind: "chunked_text",
		truncated: true,
		nextOffset: 4000,
	});
	expect(result.preview.length).toBe(4000);
	expect(result.charsReturned).toBe(4000);
});

test("chunked text results preserve line window metadata", () => {
	const result = buildChunkedTextResult("b\nc", 100, {
		label: "/workspace/line-window.txt",
		startLine: 2,
		endLine: 3,
		totalLines: 4,
		lineWindowApplied: true,
	});

	expect(result.kind).toBe("chunked_text");
	expect(result.preview).toBe("b\nc");
	expect(result.truncated).toBe(false);
	expect(result.startLine).toBe(2);
	expect(result.endLine).toBe(3);
});

test("buildThreadState returns a compact live thread snapshot", () => {
	const conversationId = `thread-test-${crypto.randomUUID()}`;
	const now = Date.now();
	const mockStore = {
		get: () => ({
			lastActivity: now,
			metadata: {
				activeRunId: "42",
				activeRunSource: "telegram",
				activeRunStatus: "running",
				activeRunPreview: "Draft a short summary of the attached notes",
				activeRunStartedAt: now - 1_000,
				activeRunUpdatedAt: now,
			},
		}),
		getRecentMessages: () => [
			{
				role: "user" as const,
				content: "Please draft a short summary of the attached notes and keep it concise.",
				timestamp: now - 500,
				source: "telegram" as const,
			},
			{
				role: "assistant" as const,
				content: "On it, I’m reviewing the notes now.",
				timestamp: now - 250,
				source: "telegram" as const,
			},
		],
		getMessagesSince: () => [
			{
				role: "user" as const,
				content: "Please draft a short summary of the attached notes and keep it concise.",
				timestamp: now - 500,
				source: "telegram" as const,
			},
		],
	};

	const state = buildThreadState(conversationId, undefined, 8, mockStore);

	expect(state.activeRun?.status).toBe("running");
	expect(state.summary).toContain("Live run running");
	expect(state.summary).toContain("Recent user updates: 1");
	expect(state.recentMessages.length).toBeGreaterThan(0);
	expect(state.recentMessages[0]?.preview.length).toBeLessThanOrEqual(180);
});

test("buildThreadState includes updates at and after the checkpoint", () => {
	const conversationId = `thread-checkpoint-${crypto.randomUUID()}`;
	const checkpoint = Date.now() - 1_000;
	const mockStore = {
		get: () => ({
			lastActivity: Date.now(),
			metadata: {
				activeRunId: "99",
				activeRunSource: "telegram",
				activeRunStatus: "running",
				activeRunPreview: "Draft the report from file A",
				activeRunStartedAt: checkpoint - 1_000,
				activeRunUpdatedAt: checkpoint,
			},
		}),
		getRecentMessages: () => [],
		getMessagesSince: () => [
			{
				role: "user" as const,
				content: "Use file B instead.",
				timestamp: checkpoint,
				source: "telegram" as const,
			},
			{
				role: "assistant" as const,
				content: "Got it, I’m switching to file B.",
				timestamp: checkpoint + 1,
				source: "telegram" as const,
			},
		],
	};

	const state = buildThreadState(conversationId, checkpoint, 8, mockStore);

	expect(state.checkpointAt).toBe(checkpoint);
	expect(state.newUserUpdates).toBe(1);
	expect(state.latestUserMessage?.preview).toContain("Use file B instead.");
	expect(state.summary).toContain("Live run running");
});

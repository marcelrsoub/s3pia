import { expect, test } from "bun:test";
import { aiTools } from "../src/ai-tools";
import { workspacePath } from "../src/workspace";

test("read_file returns chunk metadata for large files", async () => {
	const path = workspacePath("temp", "large-test.txt");
	await Bun.$`mkdir -p ${workspacePath("temp")}`;
	await Bun.write(path, "x".repeat(12000));

	const executeReadFile = aiTools.read_file.execute as unknown as (
		input: Record<string, unknown>,
		options?: Record<string, unknown>,
	) => Promise<unknown>;
	const result = (await executeReadFile(
		{
			path,
			length: 4000,
		},
		{},
	)) as {
		kind: string;
		preview: string;
		charsReturned: number;
		truncated: boolean;
		nextOffset: number | null;
	};

	expect(typeof result).toBe("object");
	expect(result).toMatchObject({
		kind: "chunked_text",
		truncated: true,
		nextOffset: 4000,
	});
	expect(result.preview.length).toBe(4000);
	expect(result.charsReturned).toBe(4000);
});

test("read_file supports line windows", async () => {
	const path = workspacePath("temp", "line-window.txt");
	await Bun.write(path, ["a", "b", "c", "d"].join("\n"));

	const executeReadFile = aiTools.read_file.execute as unknown as (
		input: Record<string, unknown>,
		options?: Record<string, unknown>,
	) => Promise<unknown>;
	const result = (await executeReadFile(
		{
			path,
			startLine: 2,
			endLine: 3,
			length: 100,
		},
		{},
	)) as {
		kind: string;
		preview: string;
		truncated: boolean;
		startLine?: number;
		endLine?: number;
	};

	expect(result.kind).toBe("chunked_text");
	expect(result.preview).toBe("b\nc");
	expect(result.truncated).toBe(false);
	expect(result.startLine).toBe(2);
	expect(result.endLine).toBe(3);
});

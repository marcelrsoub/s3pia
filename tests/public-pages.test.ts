import { afterEach, expect, test } from "bun:test";

import { servePublicPage } from "../src/public-pages";

const TEST_ROOT = "/tmp/s3pia-public-pages-test";

async function cleanupTestRoot(): Promise<void> {
	try {
		await Bun.$`rm -rf ${TEST_ROOT}`;
	} catch {
		// Ignore cleanup errors
	}
}

async function writePageFile(path: string, content: string): Promise<void> {
	await Bun.write(`${TEST_ROOT}/${path}`, content);
}

afterEach(async () => {
	await cleanupTestRoot();
});

test("serves index.html for a public page directory", async () => {
	await writePageFile("demo/index.html", "<h1>Demo</h1>");

	const response = await servePublicPage("/pages/demo/", TEST_ROOT);

	expect(response?.status).toBe(200);
	expect(response?.headers.get("Content-Type")).toContain("text/html");
	expect(await response?.text()).toBe("<h1>Demo</h1>");
});

test("serves public page assets", async () => {
	await writePageFile("demo/style.css", "body { color: red; }");

	const response = await servePublicPage("/pages/demo/style.css", TEST_ROOT);

	expect(response?.status).toBe(200);
	expect(response?.headers.get("Content-Type")).toContain("text/css");
	expect(await response?.text()).toBe("body { color: red; }");
});

test("returns 404 for a missing public page", async () => {
	const response = await servePublicPage("/pages/missing/", TEST_ROOT);

	expect(response?.status).toBe(404);
	expect(await response?.text()).toContain("Page not found");
});

test("rejects traversal outside the public pages root", async () => {
	const response = await servePublicPage("/pages/../secret.txt", TEST_ROOT);

	expect(response?.status).toBe(403);
	expect(await response?.text()).toContain("Invalid path");
});

test("ignores non-pages routes with a similar prefix", async () => {
	const response = await servePublicPage("/pagesfoo", TEST_ROOT);

	expect(response).toBeNull();
});

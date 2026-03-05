import { test, expect } from "bun:test";
import { Agent } from "../../src/agent";
import { setEnvVar, deleteEnvVar, getEnvSummary } from "../../src/env";

test("full lifecycle: model can see and use env vars", async () => {
	// Setup: create a test var
	await setEnvVar("TEST_E2E_VAR", "test_value");

	// Agent can see it in context
	const summary = await getEnvSummary();
	const found = summary.find(v => v.key === "TEST_E2E_VAR");
	expect(found?.configured).toBe(true);

	// Cleanup
	await deleteEnvVar("TEST_E2E_VAR");

	// Gone after delete
	const afterDelete = await getEnvSummary();
	const notFound = afterDelete.find(v => v.key === "TEST_E2E_VAR");
	expect(notFound).toBeUndefined();
});

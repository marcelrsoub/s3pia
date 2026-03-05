/**
 * File Parser Utilities
 *
 * Parse and strip file references from agent output.
 */

const FILE_REF_PATTERN = /\[FILE:\s*(\/[^\]]+)\]/g;

/**
 * Parse file references from content
 */
export function parseFileReferences(
	content: string,
): Array<{ path: string; displayName: string }> {
	const refs: Array<{ path: string; displayName: string }> = [];
	let match;

	while ((match = FILE_REF_PATTERN.exec(content)) !== null) {
		const path = match[1];
		const filename = path.split("/").pop() || path;
		refs.push({ path, displayName: filename });
	}

	return refs;
}

/**
 * Strip file references from content
 */
export function stripFileReferences(content: string): string {
	return content.replace(FILE_REF_PATTERN, "");
}

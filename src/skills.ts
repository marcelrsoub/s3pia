/**
 * Skills System
 *
 * Skills are reference documentation files for APIs and tools.
 * The agent can read them when needed - they are not auto-loaded.
 *
 * Skills are stored as .md files in /app/ws/skills/
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = "/app/ws/skills";

export interface Skill {
	name: string;
	filename: string;
	content: string;
}

class Skills {
	private skillsCache: Skill[] | null = null;

	/**
	 * Get list of available skill names and filenames
	 * Used to show the agent what skills exist
	 */
	async getSkillsList(): Promise<{ name: string; filename: string }[]> {
		const skills = await this.getAvailableSkills();
		return skills.map((s) => ({ name: s.name, filename: s.filename }));
	}

	/**
	 * Get all available skills from markdown files
	 */
	async getAvailableSkills(): Promise<Skill[]> {
		if (this.skillsCache) {
			return this.skillsCache;
		}

		this.skillsCache = await this.loadSkillsFromDirectory();
		return this.skillsCache;
	}

	/**
	 * Get skills summary for LLM context
	 * Returns only skill names and filenames (not full content)
	 */
	async getSkillsSummary(): Promise<string> {
		const skills = await this.getAvailableSkills();

		if (skills.length === 0) {
			return "No skills available.";
		}

		return skills.map((s) => `- **${s.name}** (${s.filename}.md)`).join("\n");
	}

	/**
	 * Get full skill content by name or filename
	 * Agent calls this when it wants to read a specific skill
	 */
	async getSkillContent(skillName: string): Promise<string | null> {
		const skills = await this.getAvailableSkills();
		const skill = skills.find(
			(s) =>
				s.name.toLowerCase() === skillName.toLowerCase() ||
				s.filename.toLowerCase() === skillName.toLowerCase(),
		);
		return skill?.content ?? null;
	}

	// --- Private methods ---

	private async loadSkillsFromDirectory(): Promise<Skill[]> {
		const skills: Skill[] = [];

		try {
			// Ensure directory exists
			if (!existsSync(SKILLS_DIR)) {
				mkdirSync(SKILLS_DIR, { recursive: true });
				return skills;
			}

			const entries = readdirSync(SKILLS_DIR);

			for (const entry of entries) {
				// Skip non-markdown files and meta-files (starting with _)
				if (!entry.endsWith(".md") || entry.startsWith("_")) continue;

				const filepath = join(SKILLS_DIR, entry);
				try {
					const content = await Bun.file(filepath).text();
					const skill = this.parseMarkdownContent(content, entry);
					if (skill) {
						skills.push(skill);
					}
				} catch {
					// Skip unreadable files
				}
			}

			console.log(`[Skills] Loaded ${skills.length} skills from ${SKILLS_DIR}`);
		} catch (err) {
			console.error("[Skills] Failed to load skills:", err);
		}

		return skills;
	}

	private parseMarkdownContent(
		content: string,
		filename: string,
	): Skill | null {
		try {
			// Extract title from first heading
			const titleMatch = content.match(/^#\s+(.+)$/m);
			const name = titleMatch?.[1]?.trim() ?? filename.replace(".md", "");

			return {
				name,
				filename: filename.replace(".md", ""),
				content,
			};
		} catch {
			return null;
		}
	}

	/**
	 * Clear cache - useful when skills are updated
	 */
	clearCache(): void {
		this.skillsCache = null;
	}
}

// Export singleton
let skillsInstance: Skills | null = null;

export function getSkills(): Skills {
	if (!skillsInstance) {
		skillsInstance = new Skills();
	}
	return skillsInstance;
}

export { Skills };

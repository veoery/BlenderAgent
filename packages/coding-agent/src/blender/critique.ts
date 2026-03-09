import { appendFile } from "node:fs/promises";
import type { CritiqueLogOptions, CritiqueLogResult } from "./types.js";
import { nowIso } from "./utils.js";
import { ensureWorkspaceCritiqueLogExists, loadWorkspaceManifest } from "./workspace.js";

function validateCritiqueScore(name: string, value: number): void {
	if (!Number.isFinite(value) || value < 0 || value > 2) {
		throw new Error(`Critique score "${name}" must be a number between 0 and 2.`);
	}
}

export async function blenderLogCritique(options: CritiqueLogOptions): Promise<CritiqueLogResult> {
	validateCritiqueScore("accuracy", options.accuracy);
	validateCritiqueScore("geometry", options.geometry);
	validateCritiqueScore("materials", options.materials);
	validateCritiqueScore("completeness", options.completeness);
	validateCritiqueScore("quality", options.quality);

	const manifest = await loadWorkspaceManifest(options.cwd, options.workspace);
	const critiqueLogPath = await ensureWorkspaceCritiqueLogExists(manifest.workspacePath);
	const iteration = options.iteration ?? manifest.latestIteration;
	const score = options.accuracy + options.geometry + options.materials + options.completeness + options.quality;
	const loggedAt = nowIso();
	const shouldPresent = score >= 8;
	const entry = {
		iteration,
		score,
		accuracy: options.accuracy,
		geometry: options.geometry,
		materials: options.materials,
		completeness: options.completeness,
		quality: options.quality,
		issues: options.issues,
		nextAction: options.nextAction,
		loggedAt,
		shouldPresent,
	};

	const logBlock = [
		`[${loggedAt}] iteration_${String(iteration).padStart(2, "0")}`,
		`Score: ${score}/10`,
		`Accuracy: ${options.accuracy}/2`,
		`Geometry & Proportions: ${options.geometry}/2`,
		`Materials & Appearance: ${options.materials}/2`,
		`Completeness: ${options.completeness}/2`,
		`Quality: ${options.quality}/2`,
		"Issues:",
		...(options.issues.length > 0 ? options.issues.map((issue) => `- ${issue}`) : ["- none"]),
		`Next action: ${options.nextAction}`,
		shouldPresent ? "Decision: present to user" : "Decision: continue iterating",
		"",
	].join("\n");

	await appendFile(critiqueLogPath, logBlock, "utf-8");

	return {
		workspacePath: manifest.workspacePath,
		critiqueLogPath,
		entry,
	};
}

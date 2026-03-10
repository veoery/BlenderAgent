import { dirname } from "node:path";
import { requestLiveBlenderSessionContext } from "./bridge.js";
import type { BlenderSessionContextCategory, SessionContextOptions, SessionContextResult } from "./types.js";
import { fileExists, LIVE_BRIDGE_TIMEOUT_MS, normalizeWorkspacePath } from "./utils.js";
import { getManifestPath, loadWorkspaceManifest } from "./workspace.js";

function shouldInclude(
	include: BlenderSessionContextCategory[] | undefined,
	category: BlenderSessionContextCategory,
): boolean {
	return !include || include.length === 0 || include.includes(category);
}

export async function blenderSessionContext(options: SessionContextOptions): Promise<SessionContextResult> {
	const bridgeResult = await requestLiveBlenderSessionContext({
		signal: options.signal,
		timeoutMs: options.timeoutMs ?? LIVE_BRIDGE_TIMEOUT_MS,
	});

	const warnings: string[] = [];
	const requestedWorkspacePath = options.workspace ? normalizeWorkspacePath(options.cwd, options.workspace) : null;
	let requestedBlendPath: string | null = null;
	let workspacePath: string | null = null;
	let matchesWorkspace: boolean | null = null;

	if (requestedWorkspacePath) {
		const manifest = await loadWorkspaceManifest(options.cwd, options.workspace ?? requestedWorkspacePath);
		requestedBlendPath = manifest.blendPath;
		matchesWorkspace = bridgeResult.blendPath === manifest.blendPath;
		workspacePath = matchesWorkspace ? manifest.workspacePath : null;
		if (!matchesWorkspace) {
			warnings.push(
				bridgeResult.blendPath
					? `Live Blender is on "${bridgeResult.blendPath}", not the requested workspace blend "${manifest.blendPath}".`
					: `Live Blender is on an unsaved scene, not the requested workspace blend "${manifest.blendPath}".`,
			);
		}
	} else if (bridgeResult.blendPath) {
		const inferredWorkspacePath = dirname(bridgeResult.blendPath);
		if (await fileExists(getManifestPath(inferredWorkspacePath))) {
			const manifest = await loadWorkspaceManifest(options.cwd, inferredWorkspacePath);
			requestedBlendPath = manifest.blendPath;
			matchesWorkspace = manifest.blendPath === bridgeResult.blendPath;
			workspacePath = matchesWorkspace ? manifest.workspacePath : null;
		}
	}

	if (!bridgeResult.isSaved) {
		warnings.push("Live Blender is on an unsaved scene.");
	}
	if (bridgeResult.isDirty) {
		warnings.push("Live Blender has unsaved changes.");
	}
	if (!bridgeResult.viewport.hasViewport) {
		warnings.push("No live VIEW_3D viewport is open in Blender.");
	}
	if (bridgeResult.selection.selectedObjectCount > 1) {
		warnings.push(
			`There are ${bridgeResult.selection.selectedObjectCount} selected objects, so ambiguous references like "it" may require clarification.`,
		);
	}

	return {
		requestedWorkspacePath,
		requestedBlendPath,
		workspacePath,
		matchesWorkspace,
		warnings,
		file: shouldInclude(options.include, "file")
			? {
					blendPath: bridgeResult.blendPath,
					isSaved: bridgeResult.isSaved,
					isDirty: bridgeResult.isDirty,
				}
			: null,
		scene: shouldInclude(options.include, "scene") ? bridgeResult.scene : null,
		selection: shouldInclude(options.include, "selection") ? bridgeResult.selection : null,
		mode: shouldInclude(options.include, "mode") ? bridgeResult.mode : null,
		viewport: shouldInclude(options.include, "viewport") ? bridgeResult.viewport : null,
	};
}

function formatSelectedObjects(result: SessionContextResult): string | null {
	const selection = result.selection;
	if (!selection || selection.selectedObjectCount === 0) {
		return null;
	}

	const names = selection.selectedObjects.slice(0, 3).map((obj) => `\`${obj.name}\``);
	const suffix = selection.selectedObjectCount > 3 ? `, +${selection.selectedObjectCount - 3} more` : "";
	return `${names.join(", ")}${suffix}`;
}

export function formatCompactSessionContextPrompt(result: SessionContextResult): string | null {
	const lines: string[] = [];
	const blendPath = result.file?.blendPath;

	if (blendPath) {
		lines.push(`- Blend: \`${blendPath}\`${result.file?.isDirty ? " (unsaved changes)" : ""}`);
	} else if (result.file && !result.file.isSaved) {
		lines.push(`- Blend: unsaved scene${result.file.isDirty ? " (dirty)" : ""}`);
	}

	if (result.workspacePath) {
		lines.push(`- Workspace: \`${result.workspacePath}\``);
	}

	if (result.scene?.name || result.scene?.activeCameraName) {
		const sceneSummary = [result.scene?.name ? `\`${result.scene.name}\`` : "unknown scene"];
		if (result.scene?.activeCameraName) {
			sceneSummary.push(`camera \`${result.scene.activeCameraName}\``);
		}
		lines.push(`- Scene: ${sceneSummary.join(", ")}`);
	}

	if (result.mode?.mode || result.selection?.activeObject) {
		const targetSummary: string[] = [];
		if (result.mode?.mode) {
			targetSummary.push(`mode \`${result.mode.mode}\``);
		}
		if (result.selection?.activeObject) {
			targetSummary.push(`active object \`${result.selection.activeObject.name}\``);
		}
		lines.push(`- Target: ${targetSummary.join(", ")}`);
	}

	const selected = formatSelectedObjects(result);
	if (selected) {
		lines.push(`- Selected: ${selected}`);
	}

	if (result.viewport?.hasViewport) {
		const viewportSummary: string[] = [];
		if (result.viewport.viewPerspective) {
			viewportSummary.push(`\`${result.viewport.viewPerspective}\``);
		}
		if (result.viewport.shadingType) {
			viewportSummary.push(`\`${result.viewport.shadingType}\``);
		}
		if (result.viewport.cameraName) {
			viewportSummary.push(`view camera \`${result.viewport.cameraName}\``);
		}
		lines.push(`- Viewport: ${viewportSummary.join(", ")}`);
	}

	const compactWarnings = result.warnings.filter(
		(warning) =>
			warning.includes("unsaved") ||
			warning.includes('ambiguous references like "it"') ||
			warning.includes("not the requested workspace"),
	);
	if (compactWarnings.length > 0) {
		lines.push(`- Warning: ${compactWarnings[0]}`);
	}

	if (lines.length === 0) {
		return null;
	}

	return ["Live Blender context:", ...lines].join("\n");
}

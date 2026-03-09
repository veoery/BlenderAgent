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
		timeoutMs: LIVE_BRIDGE_TIMEOUT_MS,
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

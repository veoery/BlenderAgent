import { requestLiveBlenderCapture } from "./bridge.js";
import { getSceneInfoFromManifest } from "./scene-info.js";
import type { BlenderSavedView, SaveViewOptions, SaveViewResult } from "./types.js";
import { getStringRecordValue, nowIso } from "./utils.js";
import { loadWorkspaceManifest, writeManifest } from "./workspace.js";

export async function blenderSaveView(options: SaveViewOptions): Promise<SaveViewResult> {
	const manifest = await loadWorkspaceManifest(options.cwd, options.workspace);
	let cameraObjectName: string | null = null;
	let cameraSettingsName: string | null = null;

	if (options.source === "active-camera") {
		const captureCameraName = options.camera_name?.trim() || options.name;
		const captureResult = await requestLiveBlenderCapture({
			blendPath: manifest.blendPath,
			viewName: options.name,
			cameraObjectName: captureCameraName,
			signal: options.signal,
		});
		cameraObjectName = captureResult.cameraObjectName;
		cameraSettingsName = captureResult.cameraSettingsName;
	} else {
		const sceneInfo = await getSceneInfoFromManifest(options.cwd, manifest, {
			categories: ["cameras"],
			signal: options.signal,
		});
		for (const camera of sceneInfo.cameras) {
			const candidate = getStringRecordValue(camera, "name");
			if (candidate && candidate === options.source) {
				cameraObjectName = candidate;
				cameraSettingsName = getStringRecordValue(camera, "cameraSettingsName");
				break;
			}
		}
	}

	if (!cameraObjectName) {
		throw new Error(`Unable to resolve view source "${options.source}" to a camera in ${manifest.blendPath}`);
	}

	const savedView: BlenderSavedView = {
		name: options.name,
		cameraObjectName,
		cameraSettingsName: cameraSettingsName ?? undefined,
		source: options.source,
		savedAt: nowIso(),
	};
	manifest.savedViews[options.name] = savedView;
	await writeManifest(manifest);

	return {
		workspacePath: manifest.workspacePath,
		manifestPath: manifest.manifestPath,
		savedView,
	};
}

export interface BlenderSavedView {
	name: string;
	cameraObjectName: string;
	cameraSettingsName?: string;
	cameraName?: string;
	source: string;
	savedAt: string;
}

export type BlenderSessionContextCategory = "file" | "scene" | "selection" | "mode" | "viewport";

export interface BlenderSessionObjectRef {
	name: string;
	type: string;
}

export interface BlenderSessionFileContext {
	blendPath: string | null;
	isSaved: boolean;
	isDirty: boolean;
}

export interface BlenderSessionSceneContext {
	name: string | null;
	availableScenes: string[];
	frameCurrent: number | null;
	activeCameraName: string | null;
}

export interface BlenderSessionSelectionContext {
	activeObject: BlenderSessionObjectRef | null;
	selectedObjects: BlenderSessionObjectRef[];
	selectedObjectCount: number;
}

export interface BlenderSessionModeContext {
	mode: string | null;
	activeObjectType: string | null;
}

export interface BlenderSessionViewportContext {
	hasViewport: boolean;
	areaSize: number | null;
	viewPerspective: string | null;
	shadingType: string | null;
	cameraName: string | null;
	isCameraView: boolean;
}

export interface BlenderRenderOutput {
	path: string;
	view: string;
	iteration: number;
	createdAt: string;
}

export interface BlenderWorkspaceManifest {
	version: 1 | 2;
	workspaceId: string;
	workspacePath: string;
	blendPath: string;
	manifestPath: string;
	createdAt: string;
	updatedAt: string;
	latestIteration: number;
	template: string;
	sourceBlendPath?: string;
	savedViews: Record<string, BlenderSavedView>;
	renderOutputs: BlenderRenderOutput[];
}

export interface WorkspaceInitOptions {
	cwd: string;
	workspace?: string;
	sourceBlend?: string;
	template?: string;
	continueExisting?: boolean;
	signal?: AbortSignal;
}

export interface WorkspaceInitResult {
	workspacePath: string;
	blendPath: string;
	manifestPath: string;
	iteration: number;
	created: boolean;
	openedInLiveBlender?: boolean;
	liveBlenderMessage?: string;
}

export interface ExecutePythonOptions {
	cwd: string;
	workspace: string;
	script_path: string;
	saveBefore?: boolean;
	saveAfter?: boolean;
	timeoutSeconds?: number;
	label?: string;
	signal?: AbortSignal;
}

export interface ExecutePythonResult {
	workspacePath: string;
	blendPath: string;
	manifestPath: string;
	iteration: number;
	sourceScriptPath: string;
	scriptPath: string;
	logPath: string;
	stdout: string;
	stderr: string;
	exitCode: number;
	changed: boolean;
}

export interface SceneInfoOptions {
	cwd: string;
	workspace: string;
	categories?: Array<
		"objects" | "collections" | "materials" | "cameras" | "cameraSettings" | "lights" | "views" | "renderSettings"
	>;
	signal?: AbortSignal;
}

export interface SceneInfoResult {
	workspacePath: string;
	blendPath: string;
	iteration: number;
	sceneInfoPath: string;
	activeCameraName: string | null;
	objects: Array<Record<string, unknown>>;
	collections: Array<Record<string, unknown>>;
	materials: Array<Record<string, unknown>>;
	cameras: Array<Record<string, unknown>>;
	cameraSettings: Array<Record<string, unknown>>;
	lights: Array<Record<string, unknown>>;
	views: BlenderSavedView[];
	renderSettings: Record<string, unknown> | null;
}

export interface SceneInfoSelection {
	includeObjects: boolean;
	includeCollections: boolean;
	includeMaterials: boolean;
	includeCameras: boolean;
	includeCameraSettings: boolean;
	includeLights: boolean;
	includeViews: boolean;
	includeRenderSettings: boolean;
}

export interface SessionContextOptions {
	cwd: string;
	workspace?: string;
	include?: BlenderSessionContextCategory[];
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface SessionContextResult {
	requestedWorkspacePath: string | null;
	requestedBlendPath: string | null;
	workspacePath: string | null;
	matchesWorkspace: boolean | null;
	warnings: string[];
	file: BlenderSessionFileContext | null;
	scene: BlenderSessionSceneContext | null;
	selection: BlenderSessionSelectionContext | null;
	mode: BlenderSessionModeContext | null;
	viewport: BlenderSessionViewportContext | null;
}

export interface SaveViewOptions {
	cwd: string;
	workspace: string;
	name: string;
	source: string;
	camera_name?: string;
	signal?: AbortSignal;
}

export interface SaveViewResult {
	workspacePath: string;
	manifestPath: string;
	savedView: BlenderSavedView;
}

export interface RenderOptions {
	cwd: string;
	workspace: string;
	view?: string;
	resolution?: {
		x: number;
		y: number;
		percentage?: number;
	};
	samples?: number;
	outputName?: string;
	mode?: string;
	signal?: AbortSignal;
}

export interface RenderResult {
	workspacePath: string;
	blendPath: string;
	iteration: number;
	outputPath: string;
	logPath: string;
	view: string;
	resolution: { x: number; y: number; percentage: number };
	mode: string;
}

export interface CritiqueLogOptions {
	cwd: string;
	workspace: string;
	iteration?: number;
	accuracy: number;
	geometry: number;
	materials: number;
	completeness: number;
	quality: number;
	viewAdequacy: string;
	issues: string[];
	nextAction: string;
}

export interface CritiqueLogResult {
	workspacePath: string;
	critiqueLogPath: string;
	entry: {
		iteration: number;
		score: number;
		accuracy: number;
		geometry: number;
		materials: number;
		completeness: number;
		quality: number;
		viewAdequacy: string;
		issues: string[];
		nextAction: string;
		loggedAt: string;
		shouldPresent: boolean;
	};
}

export interface BlenderRunResult {
	stdout: string;
	stderr: string;
	code: number;
}

export interface RunBlenderJsonOptions {
	cwd: string;
	blendPath?: string;
	scriptSource: string;
	payload: Record<string, unknown>;
	timeoutMs?: number;
	signal?: AbortSignal;
}

import { Type } from "typebox";
import { APP_NAME } from "../config.js";
import type { ExtensionFactory } from "../core/extensions/index.js";
import {
	blenderExecutePython,
	blenderLogCritique,
	blenderRender,
	blenderSaveView,
	blenderSceneInfo,
	blenderSessionContext,
	blenderWorkspaceInit,
	formatCompactSessionContextPrompt,
	getBundledBlenderSkillsDir,
} from "./runtime.js";

const BLENDER_WORKFLOW_GUIDANCE = [
	"You are operating inside vibe-blender with Blender-native tools available.",
	"Prefer Blender tools over generic shell/file workflows for scene creation, editing, inspection, and rendering.",
	"Keep the `workspace` argument explicit in every Blender tool call and reuse the same workspace across continuation turns.",
	"Author Blender code in the workspace root script.py using the normal write/edit tools, then call blender_execute_python with script_path pointing to that global script.",
	'When editing Blender materials with Principled BSDF, prefer named socket access like `bsdf.inputs["Base Color"]`, `bsdf.inputs["Roughness"]`, and `bsdf.inputs["Metallic"]` instead of hard-coded socket indices, because socket ordering can change across Blender versions and break Material Preview or Rendered mode.',
	"For `blender_render`, default to live camera-based rendering unless the user explicitly asks to use the current viewport. This avoids unexpected render view changes when the user is only navigating the Blender UI for inspection.",
	"Prefer `blender_render` with renderMethod=`live` during iteration because it is faster and better suited for inspection. Use renderMethod=`background` only when the user wants final, refined, or higher-quality render output.",
	"If an authoritative live Blender state block is present for this turn, treat it as the only current source of truth for present-tense Blender UI state such as current selection, active object, or viewport.",
	"Ignore older live Blender context summaries, earlier selection mentions in message history, and prior assistant inferences about current Blender UI state when answering present-tense questions for this turn.",
	'If the user refers to "it", "this", the selected object, or the current view and the authoritative live Blender state block is missing, stale, or insufficient, call blender_session_context to refresh live Blender selection and viewport state before mutating.',
	"Inspect before mutating when editing an existing scene, and render after meaningful scene changes that need visual verification.",
	"For create and edit work, use a short ReAct loop: execute, render, critique, log the critique, then either stop when the result is good enough or iterate. Do at most 5 iterations for each new user instruction.",
	"Do not restate tool schemas in prose. Use the tool definitions directly.",
].join(" ");

const LIVE_CONTEXT_PROMPT_TIMEOUT_MS = 1_500;

function formatJsonResult(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export function isVibeBlenderApp(appName: string): boolean {
	return appName === "vibe-blender";
}

export function getBuiltInBlenderExtensionFactories(appName: string = APP_NAME): ExtensionFactory[] {
	if (!isVibeBlenderApp(appName)) {
		return [];
	}

	const factory: ExtensionFactory = (pi) => {
		pi.registerTool({
			name: "blender_workspace_init",
			label: "Blender Workspace Init",
			description:
				"Create or reopen a managed Blender workspace with a persistent model.blend and workspace manifest, and auto-open that blend in the live Blender session when available.",
			parameters: Type.Object({
				workspace: Type.Optional(
					Type.String({
						description: "Explicit workspace path. Relative paths resolve from the current working directory.",
					}),
				),
				sourceBlend: Type.Optional(
					Type.String({
						description: "Optional source .blend file to copy into the workspace as the starting model.blend.",
					}),
				),
				template: Type.Optional(
					Type.String({
						description: 'Workspace template. Currently only "blank" is supported.',
						default: "blank",
					}),
				),
				continueExisting: Type.Optional(
					Type.Boolean({
						description: "When true, require the workspace to exist already instead of creating a new one.",
						default: false,
					}),
				),
			}),
			execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
				const result = await blenderWorkspaceInit({
					cwd: ctx.cwd,
					workspace: params.workspace,
					sourceBlend: params.sourceBlend,
					template: params.template,
					continueExisting: params.continueExisting,
					signal,
				});

				return {
					content: [{ type: "text", text: formatJsonResult(result) }],
					details: result,
				};
			},
		});

		pi.registerTool({
			name: "blender_execute_python",
			label: "Blender Execute Python",
			description:
				"Copy the workspace root Blender script into the current iteration folder, execute it inside the live bridge-enabled Blender session for the workspace, and persist the updated model.blend so the UI stays in sync.",
			parameters: Type.Object({
				workspace: Type.String({
					description: "Explicit workspace path for the Blender task.",
				}),
				script_path: Type.String({
					description:
						"Path to the existing Blender Python script to snapshot and execute. Use the workspace root script.py.",
				}),
				saveBefore: Type.Optional(
					Type.Boolean({
						description: "If true, copy the current model.blend into the iteration folder before execution.",
						default: false,
					}),
				),
				saveAfter: Type.Optional(
					Type.Boolean({
						description: "If true, save the updated Blender scene back to model.blend after execution.",
						default: true,
					}),
				),
				timeoutSeconds: Type.Optional(
					Type.Number({
						description: "Execution timeout in seconds.",
						default: 120,
					}),
				),
				label: Type.Optional(
					Type.String({
						description: "Optional label for the iteration step.",
					}),
				),
			}),
			execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
				const result = await blenderExecutePython({
					cwd: ctx.cwd,
					workspace: params.workspace,
					script_path: params.script_path,
					saveBefore: params.saveBefore,
					saveAfter: params.saveAfter,
					timeoutSeconds: params.timeoutSeconds,
					label: params.label,
					signal,
				});

				return {
					content: [{ type: "text", text: formatJsonResult(result) }],
					details: result,
				};
			},
		});

		pi.registerTool({
			name: "blender_session_context",
			label: "Blender Session Context",
			description:
				"Inspect the current live Blender UI session to resolve the open blend, active scene, current mode, active object, selected objects, and viewport state before acting on ambiguous requests like 'update it' or 'render from here'.",
			parameters: Type.Object({
				workspace: Type.Optional(
					Type.String({
						description:
							"Optional workspace path to compare against the live Blender session. Relative paths resolve from the current working directory.",
					}),
				),
				include: Type.Optional(
					Type.Array(
						Type.Union([
							Type.Literal("file"),
							Type.Literal("scene"),
							Type.Literal("selection"),
							Type.Literal("mode"),
							Type.Literal("viewport"),
						]),
						{
							description:
								"Optional live session categories to include. Omit to return the full live Blender session context.",
							uniqueItems: true,
						},
					),
				),
			}),
			execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
				const result = await blenderSessionContext({
					cwd: ctx.cwd,
					workspace: params.workspace,
					include: params.include,
					signal,
				});

				return {
					content: [{ type: "text", text: formatJsonResult(result) }],
					details: result,
				};
			},
		});

		pi.registerTool({
			name: "blender_scene_info",
			label: "Blender Scene Info",
			description:
				'Inspect the current Blender workspace, write structured scene metadata into the current iteration folder, and return it for planning or verification. Prefer a narrow `categories` list such as `["objects"]`, `["materials"]`, or `["cameras", "cameraSettings"]` when you only need one or a few sections. Omit `categories` only when you truly need the full scene info payload.',
			parameters: Type.Object({
				workspace: Type.String({
					description: "Explicit workspace path for the Blender task.",
				}),
				categories: Type.Optional(
					Type.Array(
						Type.Union([
							Type.Literal("objects"),
							Type.Literal("collections"),
							Type.Literal("materials"),
							Type.Literal("cameras"),
							Type.Literal("cameraSettings"),
							Type.Literal("lights"),
							Type.Literal("views"),
							Type.Literal("renderSettings"),
						]),
						{
							description:
								"Optional scene info categories to inspect. Pass one category to inspect only that section, or pass a short list for a subset. Omit `categories` only when you need all available scene info sections.",
							uniqueItems: true,
						},
					),
				),
			}),
			execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
				const result = await blenderSceneInfo({
					cwd: ctx.cwd,
					workspace: params.workspace,
					categories: params.categories,
					signal,
				});

				return {
					content: [{ type: "text", text: formatJsonResult(result) }],
					details: result,
				};
			},
		});

		pi.registerTool({
			name: "blender_save_view",
			label: "Blender Save View",
			description:
				"Save a named render view in the workspace manifest. With source=active-camera, capture the current live Blender UI viewport into a dedicated camera object; otherwise bind the view to an existing camera object.",
			parameters: Type.Object({
				workspace: Type.String({
					description: "Explicit workspace path for the Blender task.",
				}),
				name: Type.String({
					description: "Saved view name to store in the workspace manifest.",
				}),
				source: Type.String({
					description:
						'Either "active-camera" to capture the current Blender UI view, or a camera object name already present in the scene.',
				}),
				camera_name: Type.Optional(
					Type.String({
						description:
							'Optional dedicated camera object name to use when source is "active-camera". Defaults to the saved view name.',
					}),
				),
			}),
			execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
				const result = await blenderSaveView({
					cwd: ctx.cwd,
					workspace: params.workspace,
					name: params.name,
					source: params.source,
					camera_name: params.camera_name,
					signal,
				});

				return {
					content: [{ type: "text", text: formatJsonResult(result) }],
					details: result,
				};
			},
		});

		pi.registerTool({
			name: "blender_render",
			label: "Blender Render",
			description:
				"Render the workspace blend file and write outputs into the current iteration. Use renderMethod=`live` for viewport renders and renderMethod=`background` for normal headless scene renders. Live renders default to camera-based framing with viewportShading=`material-preview`; switch to viewSource=`current-view` only when the user explicitly wants the raw current viewport. Live viewport renders disable overlays automatically so grids, axes, and other viewport clutter are not captured. Background renders are camera-based and use renderEngine overrides such as `eevee`, `cycles`, or `workbench` instead of viewport shading modes.",
			parameters: Type.Object({
				workspace: Type.String({
					description: "Explicit workspace path for the Blender task.",
				}),
				view: Type.Optional(
					Type.String({
						description: 'Optional saved view name, camera name, or "active-camera".',
					}),
				),
				resolution: Type.Optional(
					Type.Object({
						x: Type.Number(),
						y: Type.Number(),
						percentage: Type.Optional(Type.Number()),
					}),
				),
				samples: Type.Optional(
					Type.Number({
						description: "Optional Cycles sample count override.",
					}),
				),
				outputName: Type.Optional(
					Type.String({
						description: "Output image file name. Defaults to render.png.",
					}),
				),
				renderMethod: Type.Optional(
					Type.Union([Type.Literal("live"), Type.Literal("background")], {
						description:
							"How to execute the render. `live` uses the open Blender UI viewport. `background` uses a headless scene render. Defaults to `live`.",
						default: "live",
					}),
				),
				viewSource: Type.Optional(
					Type.Union([Type.Literal("camera"), Type.Literal("current-view")], {
						description:
							"How to choose the framing. `camera` uses the saved view, explicit camera, or active camera. `current-view` uses the raw current viewport in the live Blender UI. Defaults to `camera`.",
						default: "camera",
					}),
				),
				viewportShading: Type.Optional(
					Type.Union(
						[
							Type.Literal("wireframe"),
							Type.Literal("solid"),
							Type.Literal("material-preview"),
							Type.Literal("rendered"),
						],
						{
							description:
								"Viewport shading mode for live renders only. Defaults to `material-preview`. `solid` uses Workbench-style viewport shading. `rendered` uses the scene render engine interactively.",
							default: "material-preview",
						},
					),
				),
				renderEngine: Type.Optional(
					Type.Union([Type.Literal("eevee"), Type.Literal("cycles"), Type.Literal("workbench")], {
						description:
							"Optional render engine override for background renders only. Omit to keep the scene's current engine.",
					}),
				),
			}),
			execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
				const result = await blenderRender({
					cwd: ctx.cwd,
					workspace: params.workspace,
					view: params.view,
					resolution: params.resolution,
					samples: params.samples,
					outputName: params.outputName,
					renderMethod: params.renderMethod,
					viewSource: params.viewSource,
					viewportShading: params.viewportShading,
					renderEngine: params.renderEngine,
					signal,
				});

				return {
					content: [{ type: "text", text: formatJsonResult(result) }],
					details: result,
				};
			},
		});

		pi.registerTool({
			name: "blender_log_critique",
			label: "Blender Log Critique",
			description:
				"Append a structured critique entry to the workspace critique.log using the 0-10 Blender iteration rubric, plus a view adequacy judgment for the current render perspective.",
			parameters: Type.Object({
				workspace: Type.String({
					description: "Explicit workspace path for the Blender task.",
				}),
				iteration: Type.Optional(
					Type.Number({
						description: "Optional iteration number. Defaults to the current workspace iteration.",
					}),
				),
				accuracy: Type.Number({
					description: "Accuracy score from 0 to 2.",
					minimum: 0,
					maximum: 2,
				}),
				geometry: Type.Number({
					description: "Geometry and proportions score from 0 to 2.",
					minimum: 0,
					maximum: 2,
				}),
				materials: Type.Number({
					description: "Materials and appearance score from 0 to 2.",
					minimum: 0,
					maximum: 2,
				}),
				completeness: Type.Number({
					description: "Completeness score from 0 to 2.",
					minimum: 0,
					maximum: 2,
				}),
				quality: Type.Number({
					description: "Quality score from 0 to 2.",
					minimum: 0,
					maximum: 2,
				}),
				viewAdequacy: Type.String({
					description:
						"Non-scored judgment of whether the current render view is good enough for evaluation, including any framing, coverage, or perspective problems.",
				}),
				issues: Type.Array(
					Type.String({
						description: "Concrete problems found in the current render or scene.",
					}),
				),
				nextAction: Type.String({
					description: 'Either a fix to attempt next or "present to user" when the result is good enough.',
				}),
			}),
			execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
				const result = await blenderLogCritique({
					cwd: ctx.cwd,
					workspace: params.workspace,
					iteration: params.iteration,
					accuracy: params.accuracy,
					geometry: params.geometry,
					materials: params.materials,
					completeness: params.completeness,
					quality: params.quality,
					viewAdequacy: params.viewAdequacy,
					issues: params.issues,
					nextAction: params.nextAction,
				});

				return {
					content: [{ type: "text", text: formatJsonResult(result) }],
					details: result,
				};
			},
		});

		pi.on("resources_discover", () => ({
			skillPaths: [getBundledBlenderSkillsDir()],
		}));

		pi.on("before_agent_start", async (_event, ctx) => {
			let liveContextPrompt = "";
			try {
				const liveContext = await blenderSessionContext({
					cwd: ctx.cwd,
					include: ["file", "scene", "selection", "mode", "viewport"],
					timeoutMs: LIVE_CONTEXT_PROMPT_TIMEOUT_MS,
				});
				liveContextPrompt = formatCompactSessionContextPrompt(liveContext) ?? "";
			} catch {
				liveContextPrompt = "";
			}

			return {
				message: {
					customType: "blender_context",
					content: [BLENDER_WORKFLOW_GUIDANCE, liveContextPrompt].filter((part) => part.length > 0).join("\n\n"),
					display: true,
				},
			};
		});
	};

	return [factory];
}

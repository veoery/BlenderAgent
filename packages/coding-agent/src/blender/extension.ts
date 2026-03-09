import { Type } from "@sinclair/typebox";
import { APP_NAME } from "../config.js";
import type { ExtensionFactory } from "../core/extensions/index.js";
import {
	blenderExecutePython,
	blenderLogCritique,
	blenderRender,
	blenderSaveView,
	blenderSceneInfo,
	blenderWorkspaceInit,
	getBundledBlenderSkillsDir,
} from "./runtime.js";

const BLENDER_WORKFLOW_GUIDANCE = [
	"You are operating inside vibe-blender with Blender-native tools available.",
	"Prefer Blender tools over generic shell/file workflows for scene creation, editing, inspection, and rendering.",
	"Keep the `workspace` argument explicit in every Blender tool call and reuse the same workspace across continuation turns.",
	"Author Blender code in the workspace root script.py using the normal write/edit tools, then call blender_execute_python with script_path pointing to that global script.",
	"Inspect before mutating when editing an existing scene, and render after meaningful scene changes that need visual verification.",
	"For create and edit work, use a short ReAct loop: execute, render, critique, log the critique, then either stop when the result is good enough or iterate. Do at most 5 iterations for each new user instruction.",
	"Do not restate tool schemas in prose. Use the tool definitions directly.",
].join(" ");

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
			name: "blender_scene_info",
			label: "Blender Scene Info",
			description:
				"Inspect the current Blender workspace, write structured scene metadata into the current iteration folder, and return it for planning or verification.",
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
								"Optional scene info categories to inspect. Omit to inspect all categories. Provide one item for one category or multiple items for a subset.",
							uniqueItems: true,
						},
					),
				),
				includeObjects: Type.Optional(Type.Boolean({ default: true })),
				includeCollections: Type.Optional(Type.Boolean({ default: true })),
				includeMaterials: Type.Optional(Type.Boolean({ default: true })),
				includeCameras: Type.Optional(Type.Boolean({ default: true })),
				includeCameraSettings: Type.Optional(Type.Boolean({ default: true })),
				includeLights: Type.Optional(Type.Boolean({ default: true })),
				includeRenderSettings: Type.Optional(Type.Boolean({ default: true })),
			}),
			execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
				const result = await blenderSceneInfo({
					cwd: ctx.cwd,
					workspace: params.workspace,
					categories: params.categories,
					includeObjects: params.includeObjects,
					includeCollections: params.includeCollections,
					includeMaterials: params.includeMaterials,
					includeCameras: params.includeCameras,
					includeCameraSettings: params.includeCameraSettings,
					includeLights: params.includeLights,
					includeRenderSettings: params.includeRenderSettings,
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
				"Render the workspace blend file from a saved view, explicit camera, or the active camera, and write outputs into the current iteration. The default mode uses Blender's material preview viewport render.",
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
				mode: Type.Optional(
					Type.String({
						description:
							'Render mode. Defaults to "material-preview" for viewport-style material preview renders. Use "still" for the final background render path.',
						default: "material-preview",
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
					mode: params.mode,
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
				"Append a structured critique entry to the workspace critique.log using the 0-10 Blender iteration rubric.",
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

		pi.on("before_agent_start", (event) => ({
			systemPrompt: `${event.systemPrompt}\n\n${BLENDER_WORKFLOW_GUIDANCE}`,
		}));
	};

	return [factory];
}

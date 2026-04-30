import { existsSync } from "node:fs";
import type { TObject } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { getBuiltInBlenderExtensionFactories, isVibeBlenderApp } from "../src/blender/extension.js";
import { getBundledBlenderSkillsDir } from "../src/blender/runtime.js";
import { createEventBus } from "../src/core/event-bus.js";
import type { BeforeAgentStartEventResult, ExtensionContext } from "../src/core/extensions/index.js";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.js";

function getToolProperties(parameters: unknown): Record<string, unknown> {
	return (parameters as TObject).properties as Record<string, unknown>;
}

describe("built-in blender extension", () => {
	afterEach(() => {
		delete process.env.BLENDER_PATH;
	});

	it("only activates for vibe-blender", () => {
		expect(isVibeBlenderApp("vibe-blender")).toBe(true);
		expect(isVibeBlenderApp("pi")).toBe(false);
		expect(getBuiltInBlenderExtensionFactories("pi")).toHaveLength(0);
		expect(getBuiltInBlenderExtensionFactories("vibe-blender")).toHaveLength(1);
	});

	it("registers Blender tools and workflow hooks", async () => {
		const [factory] = getBuiltInBlenderExtensionFactories("vibe-blender");
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(factory, process.cwd(), createEventBus(), runtime, "<blender>");

		expect(extension.tools.has("blender_workspace_init")).toBe(true);
		expect(extension.tools.has("blender_execute_python")).toBe(true);
		expect(extension.tools.has("blender_session_context")).toBe(true);
		expect(extension.tools.has("blender_scene_info")).toBe(true);
		expect(extension.tools.has("blender_save_view")).toBe(true);
		expect(extension.tools.has("blender_render")).toBe(true);
		expect(extension.tools.has("blender_log_critique")).toBe(true);
		expect(extension.handlers.has("before_agent_start")).toBe(true);
		expect(extension.handlers.has("resources_discover")).toBe(true);
		expect(extension.tools.get("blender_workspace_init")?.definition.description).toContain("auto-open");
		expect(extension.tools.get("blender_execute_python")?.definition.description).toContain("live bridge-enabled");
		expect(extension.tools.get("blender_session_context")?.definition.description).toContain("selected objects");
		expect(extension.tools.get("blender_render")?.definition.description).toContain("renderMethod=`live`");
		expect(extension.tools.get("blender_log_critique")?.definition.description).toContain("view adequacy");
	});

	it("allows blender_session_context to target one or more live context categories", async () => {
		const [factory] = getBuiltInBlenderExtensionFactories("vibe-blender");
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(factory, process.cwd(), createEventBus(), runtime, "<blender>");
		const sessionContextTool = extension.tools.get("blender_session_context");
		expect(sessionContextTool).toBeDefined();
		const properties = getToolProperties(sessionContextTool?.definition.parameters);
		expect(properties.workspace).toBeDefined();
		expect(properties.include).toBeDefined();
		expect(JSON.stringify(properties.include)).toContain("selection");
		expect(JSON.stringify(properties.include)).toContain("viewport");
	});

	it("allows blender_scene_info to target one or more categories", async () => {
		const [factory] = getBuiltInBlenderExtensionFactories("vibe-blender");
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(factory, process.cwd(), createEventBus(), runtime, "<blender>");
		const sceneInfoTool = extension.tools.get("blender_scene_info");
		expect(sceneInfoTool).toBeDefined();
		const properties = getToolProperties(sceneInfoTool?.definition.parameters);
		expect(properties.categories).toBeDefined();
		expect(JSON.stringify(properties.categories)).toContain("views");
		expect(JSON.stringify(properties.categories)).toContain("cameraSettings");
		expect(properties.includeObjects).toBeUndefined();
		expect(properties.includeCameras).toBeUndefined();
	});

	it("allows blender_save_view to capture the live UI view into a dedicated camera", async () => {
		const [factory] = getBuiltInBlenderExtensionFactories("vibe-blender");
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(factory, process.cwd(), createEventBus(), runtime, "<blender>");
		const saveViewTool = extension.tools.get("blender_save_view");
		expect(saveViewTool).toBeDefined();
		const properties = getToolProperties(saveViewTool?.definition.parameters);
		expect(properties.camera_name).toBeDefined();
		expect(JSON.stringify(properties.source)).toContain("current Blender UI view");
	});

	it("exposes the reorganized blender_render API", async () => {
		const [factory] = getBuiltInBlenderExtensionFactories("vibe-blender");
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(factory, process.cwd(), createEventBus(), runtime, "<blender>");
		const renderTool = extension.tools.get("blender_render");
		expect(renderTool).toBeDefined();
		const properties = getToolProperties(renderTool?.definition.parameters);
		expect(properties.renderMethod).toBeDefined();
		expect(properties.viewSource).toBeDefined();
		expect(properties.viewportShading).toBeDefined();
		expect(properties.renderEngine).toBeDefined();
		expect(JSON.stringify(properties.viewportShading)).toContain("material-preview");
		expect(JSON.stringify(properties.renderEngine)).toContain("workbench");
		expect(properties.mode).toBeUndefined();
	});

	it("requires blender_log_critique to record view adequacy", async () => {
		const [factory] = getBuiltInBlenderExtensionFactories("vibe-blender");
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(factory, process.cwd(), createEventBus(), runtime, "<blender>");
		const critiqueTool = extension.tools.get("blender_log_critique");
		expect(critiqueTool).toBeDefined();
		const properties = getToolProperties(critiqueTool?.definition.parameters);
		expect(properties.viewAdequacy).toBeDefined();
		expect(JSON.stringify(properties.viewAdequacy)).toContain("render view");
	});

	it("injects Blender guidance as a visible message instead of replacing the system prompt", async () => {
		const [factory] = getBuiltInBlenderExtensionFactories("vibe-blender");
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(factory, process.cwd(), createEventBus(), runtime, "<blender>");
		const beforeAgentStartHandlers = extension.handlers.get("before_agent_start");
		expect(beforeAgentStartHandlers).toHaveLength(1);
		const beforeAgentStart = beforeAgentStartHandlers?.[0];
		expect(beforeAgentStart).toBeDefined();
		if (!beforeAgentStart) {
			throw new Error("before_agent_start handler missing");
		}

		const result = (await beforeAgentStart(
			{
				type: "before_agent_start",
				prompt: "Create a cube",
				images: undefined,
				systemPrompt: "Base system prompt",
			},
			{
				cwd: process.cwd(),
			} as ExtensionContext,
		)) as BeforeAgentStartEventResult | undefined;

		expect(result?.systemPrompt).toBeUndefined();
		expect(result?.message).toBeDefined();
		expect(result?.message?.customType).toBe("blender_context");
		expect(result?.message?.display).toBe(true);
		expect(result?.message?.content).toContain(
			"You are operating inside vibe-blender with Blender-native tools available.",
		);
	});

	it("ships bundled Blender skills", () => {
		const skillsDir = getBundledBlenderSkillsDir();
		expect(existsSync(skillsDir)).toBe(true);
		expect(existsSync(`${skillsDir}/blender-create/SKILL.md`)).toBe(true);
		expect(existsSync(`${skillsDir}/blender-edit/SKILL.md`)).toBe(true);
		expect(existsSync(`${skillsDir}/blender-analyze/SKILL.md`)).toBe(true);
		expect(existsSync(`${skillsDir}/blender-with-reference/SKILL.md`)).toBe(true);
	});
});

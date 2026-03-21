import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useState, useRef, useEffect, useMemo } from "react";

interface AgentChunk {
  text: string;
  channel: "stdout" | "stderr";
}

interface AgentDone {
  exitCode: number;
  repoRoot: string;
}

interface OutputLine {
  text: string;
  channel: "stdout" | "stderr";
}

interface RenderPreview {
  workspacePath: string;
  imagePath: string;
  view: string;
  iteration: number;
  createdAt: string;
}

interface RenderPreviewResult {
  workspacePath: string;
  previews: RenderPreview[];
}

type RunStatus = "idle" | "running" | "stopping" | "success" | "error";
type AppMode = "launcher" | "blender-chat";
type BlenderTaskMode = "create" | "edit";

const starterPrompts = [
  "做一个现代风格的咖啡桌，胡桃木桌面，黑色金属细腿，放在干净的摄影棚里。",
  "创建一个桌面台灯，玻璃灯罩，金属灯体，整体偏北欧风格。",
  "做一个红色立方体，放在世界原点，尺寸是 2 米，并渲染出来。",
  "在当前模型基础上把桌腿改细一点，桌面再加一点倒角。",
  "在现有场景里增加一个更低机位的透视视角并重新渲染。",
];

const keywordCandidates = [
  "coffee table",
  "table",
  "lamp",
  "chair",
  "cube",
  "sofa",
  "desk",
  "modern",
  "minimal",
  "stylized",
  "wood",
  "metal",
  "glass",
  "red",
  "blue",
  "green",
  "white",
  "black",
  "small",
  "large",
  "round",
  "square",
  "render",
  "camera",
  "workspace",
];

function extractKeywords(input: string): string[] {
  const normalized = input.toLowerCase();
  const found = keywordCandidates.filter((candidate) => normalized.includes(candidate));

  const tokens = normalized
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !["with", "that", "this", "from", "into", "then"].includes(token));

  for (const token of tokens) {
    if (!found.includes(token)) {
      found.push(token);
    }
    if (found.length >= 8) {
      break;
    }
  }

  return found.slice(0, 8);
}

function buildBlenderPrompt(
  userIntent: string,
  repoPath: string,
  keywords: string[],
  taskMode: BlenderTaskMode,
  workspaceTarget: string,
): string {
  const trimmedIntent = userIntent.trim();
  if (!trimmedIntent) {
    return "";
  }

  const repoHint = repoPath.trim() ? `Repository path: ${repoPath.trim()}\n` : "";
  const keywordLine = keywords.length > 0 ? `Keywords: ${keywords.join(", ")}.\n` : "";
  const skill = taskMode === "create" ? "blender-create" : "blender-edit";
  const modeLine =
    taskMode === "create"
      ? `Create a new Blender asset or scene in workspace ${workspaceTarget}.\n`
      : `Continue editing only the existing Blender workspace ${workspaceTarget}.\n`;
  const actionLine =
    taskMode === "create"
      ? "Build the requested object from scratch, then inspect and render it."
      : "Modify the existing object or scene based on the user's request, then inspect and render the updated result.";
  const strictRules =
    taskMode === "create"
      ? [
          `You must initialize or continue only workspace=${workspaceTarget}.`,
          "Do not reuse or write to any previous workspace.",
          `Execute the Blender script in ${workspaceTarget}.`,
          `Render after execution and save render outputs into ${workspaceTarget} only.`,
          "If rendering fails, inspect, fix, and render again before finishing.",
        ]
      : [
          `You must continue only workspace=${workspaceTarget}.`,
          "Do not create or switch to a different workspace unless the user explicitly asks.",
          `Inspect the current scene in ${workspaceTarget} before editing it.`,
          `After editing, render and save render outputs into ${workspaceTarget} only.`,
          "If rendering fails, inspect, fix, and render again before finishing.",
        ];

  return (
    `Use /skill:${skill}.\n` +
    `${repoHint}` +
    `User request: ${trimmedIntent}\n` +
    `${keywordLine}` +
    `${modeLine}` +
    `${actionLine}\n` +
    `${strictRules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")}`
  );
}

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>("launcher");
  const [repoPath, setRepoPath] = useState("");
  const [userIntent, setUserIntent] = useState("Create a modern coffee table with a walnut top and slim black legs.");
  const [taskMode, setTaskMode] = useState<BlenderTaskMode>("create");
  const [workspaceName, setWorkspaceName] = useState("modern_coffee_table");
  const [currentWorkspace, setCurrentWorkspace] = useState("outputs/simple_red_cube");
  const [outputLines, setOutputLines] = useState<OutputLine[]>([]);
  const [repoRoot, setRepoRoot] = useState("");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [previewWorkspace, setPreviewWorkspace] = useState("");
  const [renderPreviews, setRenderPreviews] = useState<RenderPreview[]>([]);
  const [launchError, setLaunchError] = useState("");
  const outputRef = useRef<HTMLPreElement>(null);
  const unlistenersRef = useRef<UnlistenFn[]>([]);

  const extractedKeywords = useMemo(() => extractKeywords(userIntent), [userIntent]);
  const suggestedWorkspaceName = useMemo(() => {
    const workspaceHint = extractedKeywords
      .slice(0, 3)
      .map((keyword) => keyword.replace(/\s+/g, "_"))
      .join("_");
    return workspaceHint || "new_blender_task";
  }, [extractedKeywords]);
  const workspaceTarget = taskMode === "create" ? `outputs/${workspaceName.trim() || suggestedWorkspaceName}` : currentWorkspace.trim();
  const prompt = useMemo(
    () => buildBlenderPrompt(userIntent, repoPath, extractedKeywords, taskMode, workspaceTarget),
    [userIntent, repoPath, extractedKeywords, taskMode, workspaceTarget],
  );

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputLines]);

  useEffect(() => {
    return () => {
      for (const fn of unlistenersRef.current) fn();
    };
  }, []);

  function cleanupListeners() {
    for (const fn of unlistenersRef.current) fn();
    unlistenersRef.current = [];
  }

  async function refreshRenderPreviews() {
    try {
      const result = await invoke<RenderPreviewResult | null>("get_render_previews", {
        repoPath: repoPath.trim() || null,
      });
      setPreviewWorkspace(result?.workspacePath ?? "");
      setRenderPreviews(result?.previews ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }

  async function handleBlenderClick() {
    setLaunchError("");

    try {
      await invoke("launch_blender");
      setAppMode("blender-chat");
      void refreshRenderPreviews();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLaunchError(message);
    }
  }

  async function runPrompt() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError("Describe what you want in natural language first.");
      return;
    }

    cleanupListeners();
    setIsRunning(true);
    setError("");
    setRunStatus("running");
    setOutputLines([]);
    setRepoRoot("");
    setExitCode(null);

    const unlistenChunk = await listen<AgentChunk>("agent-chunk", (event) => {
      setOutputLines((prev) => [
        ...prev,
        { text: event.payload.text, channel: event.payload.channel },
      ]);
    });

    const unlistenDone = await listen<AgentDone>("agent-done", (event) => {
      setExitCode(event.payload.exitCode);
      setRepoRoot(event.payload.repoRoot);
      setIsRunning(false);
      setIsStopping(false);
      setRunStatus(event.payload.exitCode === 0 ? "success" : "error");
      cleanupListeners();
      void refreshRenderPreviews();
    });

    unlistenersRef.current = [unlistenChunk, unlistenDone];

    try {
      await invoke("run_agent_stream", {
        prompt: trimmedPrompt,
        repoPath: repoPath.trim() || null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setIsRunning(false);
      setIsStopping(false);
      setRunStatus("error");
      cleanupListeners();
    }
  }

  async function stopPrompt() {
    if (!isRunning || isStopping) {
      return;
    }

    setIsStopping(true);
    setError("");
    setRunStatus("stopping");

    try {
      const stopped = await invoke<boolean>("stop_agent_run");
      if (!stopped) {
        setIsStopping(false);
        setRunStatus("idle");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setIsStopping(false);
      setRunStatus("error");
    }
  }

  function getStatusLabel(status: RunStatus): string {
    switch (status) {
      case "idle":
        return "Idle";
      case "running":
        return "Running";
      case "stopping":
        return "Stopping";
      case "success":
        return "Success";
      case "error":
        return "Error";
    }
  }

  function getStatusClass(status: RunStatus): string {
    switch (status) {
      case "idle":
        return "status-badge status-idle";
      case "running":
        return "status-badge status-running";
      case "stopping":
        return "status-badge status-stopping";
      case "success":
        return "status-badge status-success";
      case "error":
        return "status-badge status-error";
    }
  }

  const stdoutLines = outputLines.filter((l) => l.channel === "stdout");
  const stderrLines = outputLines.filter((l) => l.channel === "stderr");

  if (appMode === "launcher") {
    return (
      <main className="app-shell shell-light">
        <section className="canvas">
          <header className="topbar">
            <nav className="pill-nav">
              <span className="pill-nav-item pill-nav-item-active">Home</span>
              <span className="pill-nav-item">Blender</span>
            </nav>
            <div className="brand-mark">BlendDock</div>
            <div className="topbar-actions">
              <button type="button" className="ghost-button">Contact</button>
              <button type="button" className="icon-button" aria-label="Menu">≡</button>
            </div>
          </header>

          <section className="hero launcher-hero">
            <p className="eyebrow">Blender workspace</p>
            <h1>Open Blender and start the session</h1>
            <p className="hero-copy">
              This desktop shell is currently focused on Blender only. Open the workspace,
              describe the model or edit pass in natural language, then review renders here.
            </p>
          </section>

          <section className="app-grid app-grid-single">
            <button
              type="button"
              className="app-card app-card-ready blender-launch-card"
              onClick={() => void handleBlenderClick()}
            >
              <div className="app-card-top">
                <h2>Blender</h2>
                <span className="status-badge status-success">Ready</span>
              </div>
              <div className="app-card-media" />
              <p>
                3D scene generation, workspace-based iteration, render previews,
                and continuing edits on the current model.
              </p>
            </button>
          </section>

          {launchError ? (
            <section className="panel error-panel">
              <p className="error">{launchError}</p>
            </section>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell shell-light">
      <section className="canvas">
        <header className="topbar">
          <nav className="pill-nav">
            <button
              type="button"
              className="pill-nav-item button-reset"
              onClick={() => !isRunning && setAppMode("launcher")}
            >
              Apps
            </button>
            <span className="pill-nav-item pill-nav-item-active">Blender</span>
            <span className="pill-nav-item">Sessions</span>
          </nav>
          <div className="brand-mark">BlendDock</div>
          <div className="topbar-actions">
            <span className={getStatusClass(runStatus)}>{getStatusLabel(runStatus)}</span>
          </div>
        </header>

        <section className="hero hero-compact">
          <div className="hero-copy-block">
            <p className="eyebrow">Blender workspace</p>
            <h1>Shape the next scene</h1>
            <p className="hero-copy">
              Start from natural language, choose whether this is a fresh build or an edit pass,
              then let the agent execute, inspect, and render the result.
            </p>
          </div>
          <div className="hero-actions">
            <button
              type="button"
              className="secondary-button hero-button"
              onClick={() => setAppMode("launcher")}
              disabled={isRunning}
            >
              Back to apps
            </button>
          </div>
        </section>

        <section className="editor-layout">
          <section className="panel panel-primary">
            <label className="field">
              <span>Natural language request</span>
              <textarea
                value={userIntent}
                onChange={(e) => setUserIntent(e.target.value)}
                rows={6}
                disabled={isRunning}
              />
            </label>

            <div className="field">
              <span>Task mode</span>
              <div className="mode-toggle" role="tablist" aria-label="Blender task mode">
                <button
                  type="button"
                  className={taskMode === "create" ? "mode-chip mode-chip-active" : "mode-chip"}
                  onClick={() => setTaskMode("create")}
                  disabled={isRunning}
                >
                  New object
                </button>
                <button
                  type="button"
                  className={taskMode === "edit" ? "mode-chip mode-chip-active" : "mode-chip"}
                  onClick={() => setTaskMode("edit")}
                  disabled={isRunning}
                >
                  Modify current
                </button>
              </div>
            </div>

            <div className="field">
              <span>Detected keywords</span>
              <div className="keyword-list">
                {extractedKeywords.length > 0 ? (
                  extractedKeywords.map((keyword) => (
                    <span key={keyword} className="keyword-chip">
                      {keyword}
                    </span>
                  ))
                ) : (
                  <span className="keyword-empty">Type a request and keywords will appear here.</span>
                )}
              </div>
            </div>

            <div className="actions">
              <button type="button" onClick={runPrompt} disabled={isRunning}>
                {isRunning ? (
                  <span className="spinner-label">
                    <span className="spinner" />
                    Running…
                  </span>
                ) : (
                  "Run agent"
                )}
              </button>
              <button
                type="button"
                onClick={stopPrompt}
                disabled={!isRunning || isStopping}
                className="secondary-button toolbar-button"
              >
                {isStopping ? "Stopping..." : "Stop"}
              </button>
              <button
                type="button"
                onClick={() => void refreshRenderPreviews()}
                disabled={isRunning}
                className="secondary-button toolbar-button"
              >
                Refresh previews
              </button>
            </div>

            {error ? <p className="error">{error}</p> : null}
          </section>

          <aside className="panel panel-secondary">
            <div className="info-stack">
              <div className="info-card">
                <h3>Starter ideas</h3>
                <select
                  value={userIntent}
                  onChange={(e) => setUserIntent(e.target.value)}
                  disabled={isRunning}
                >
                  {starterPrompts.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="info-card">
                <h3>Repository path</h3>
                <input
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="Leave empty to auto-detect"
                  disabled={isRunning}
                />
              </div>

              <div className="info-card">
                <h3>{taskMode === "create" ? "New workspace" : "Current workspace"}</h3>
                {taskMode === "create" ? (
                  <>
                    <input
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      placeholder={suggestedWorkspaceName}
                      disabled={isRunning}
                    />
                    <p className="info-note">Writes only to: {workspaceTarget}</p>
                  </>
                ) : (
                  <>
                    <input
                      value={currentWorkspace}
                      onChange={(e) => setCurrentWorkspace(e.target.value)}
                      placeholder="outputs/simple_red_cube"
                      disabled={isRunning}
                    />
                    <p className="info-note">Edits and renders only in: {workspaceTarget || "set a workspace"}</p>
                  </>
                )}
              </div>

              <div className="info-card">
                <h3>Session facts</h3>
                <dl className="meta">
                  <div>
                    <dt>Repo root</dt>
                    <dd>{repoRoot || "Not run yet"}</dd>
                  </div>
                  <div>
                    <dt>Exit code</dt>
                    <dd>{exitCode ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Preview workspace</dt>
                    <dd>{previewWorkspace || "No workspace yet"}</dd>
                  </div>
                  <div>
                    <dt>Target workspace</dt>
                    <dd>{workspaceTarget || "Not set"}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </aside>
        </section>

        <section className="results-grid">
          <article className="panel">
            <h2>
              Output
              {exitCode !== null ? <span className="badge">exit {exitCode}</span> : null}
            </h2>
            <pre ref={outputRef}>
              {stdoutLines.length > 0
                ? stdoutLines.map((l, i) => <span key={i}>{l.text}{"\n"}</span>)
                : outputLines.length > 0
                  ? null
                  : "No output yet."}
            </pre>
          </article>

          <article className="panel">
            <h2>Progress log</h2>
            <pre>
              {stderrLines.length > 0
                ? stderrLines.map((l, i) => (
                    <span key={i} className="stderr-line">
                      {l.text}{"\n"}
                    </span>
                  ))
                : isStopping
                  ? "Stopping agent…"
                  : isRunning
                    ? "Waiting for agent…"
                    : repoRoot
                      ? `Done · ${repoRoot}`
                      : "Not run yet."}
            </pre>
          </article>
        </section>

        <section className="panel preview-panel">
          <div className="preview-header">
            <h2>Render previews</h2>
            {previewWorkspace ? <span className="badge">{previewWorkspace}</span> : null}
          </div>

          {renderPreviews.length > 0 ? (
            <div className="preview-grid">
              {renderPreviews.map((preview) => (
                <figure key={`${preview.imagePath}-${preview.createdAt}`} className="preview-card">
                  <img
                    src={convertFileSrc(preview.imagePath)}
                    alt={`${preview.view} iteration ${preview.iteration}`}
                  />
                  <figcaption>
                    <strong>{preview.view}</strong>
                    <span>Iteration {preview.iteration}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="preview-empty">
              No render previews found yet. Run a Blender task, then click <code>Refresh previews</code>.
            </p>
          )}
        </section>
      </section>
    </main>
  );
}

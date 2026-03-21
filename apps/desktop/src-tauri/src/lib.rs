use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::fs;
use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize)]
struct AgentResponse {
    prompt: String,
    stdout: String,
    stderr: String,
    exit_code: i32,
    repo_root: String,
}

#[derive(Serialize, Clone)]
struct AgentChunk {
    text: String,
    channel: String,
}

#[derive(Serialize, Clone)]
struct AgentDone {
    exit_code: i32,
    repo_root: String,
}

#[derive(Deserialize)]
struct WorkspaceManifest {
    #[serde(rename = "workspacePath")]
    workspace_path: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    #[serde(rename = "renderOutputs", default)]
    render_outputs: Vec<WorkspaceRenderOutput>,
}

#[derive(Deserialize)]
struct WorkspaceRenderOutput {
    path: String,
    view: String,
    iteration: i32,
    #[serde(rename = "createdAt")]
    created_at: String,
}

#[derive(Serialize)]
struct RenderPreview {
    workspace_path: String,
    image_path: String,
    view: String,
    iteration: i32,
    created_at: String,
}

#[derive(Serialize)]
struct RenderPreviewResult {
    workspace_path: String,
    previews: Vec<RenderPreview>,
}

#[derive(Default)]
struct AppState {
    active_pid: Mutex<Option<u32>>,
}

fn default_repo_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .ancestors()
        .nth(2)
        .map(Path::to_path_buf)
        .ok_or_else(|| "Failed to infer repository root from the Tauri app location".to_string())
}

fn validate_repo_root(path: &Path) -> Result<(), String> {
    let entry = path.join("pi-test.sh");
    if !entry.exists() {
        return Err(format!(
            "Expected BlenderAgent entry script at {}",
            entry.display()
        ));
    }
    Ok(())
}

fn outputs_dir(repo_root: &Path) -> PathBuf {
    repo_root.join("outputs")
}

#[tauri::command]
fn launch_blender() -> Result<(), String> {
    if let Ok(blender_path) = env::var("BLENDER_PATH") {
        let path = PathBuf::from(&blender_path);
        if !path.exists() {
            return Err(format!("BLENDER_PATH does not exist: {}", path.display()));
        }

        Command::new(path)
            .spawn()
            .map_err(|error| format!("Failed to launch Blender from BLENDER_PATH: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-a")
            .arg("Blender")
            .spawn()
            .map_err(|error| format!("Failed to launch Blender with macOS open command: {error}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Blender launching is currently only configured for macOS or BLENDER_PATH.".to_string())
}

fn latest_workspace_manifest(repo_root: &Path) -> Result<Option<WorkspaceManifest>, String> {
    let outputs = outputs_dir(repo_root);
    if !outputs.exists() {
        return Ok(None);
    }

    let mut manifests: Vec<WorkspaceManifest> = Vec::new();

    for entry in fs::read_dir(&outputs).map_err(|error| format!("Failed to read outputs directory: {error}"))? {
        let entry = entry.map_err(|error| format!("Failed to inspect outputs entry: {error}"))?;
        let path = entry.path().join("blender-workspace.json");
        if !path.exists() {
            continue;
        }

        let content =
            fs::read_to_string(&path).map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
        let manifest: WorkspaceManifest = serde_json::from_str(&content)
            .map_err(|error| format!("Failed to parse {}: {error}", path.display()))?;
        manifests.push(manifest);
    }

    manifests.sort_by(|a, b| a.updated_at.cmp(&b.updated_at));
    Ok(manifests.pop())
}

#[tauri::command]
async fn run_agent_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    prompt: String,
    repo_path: Option<String>,
) -> Result<(), String> {
    let repo_root = if let Some(path) = repo_path {
        PathBuf::from(path)
    } else {
        default_repo_root()?
    };

    validate_repo_root(&repo_root)?;

    let repo_root_str = repo_root.display().to_string();
    {
        let active_pid = state
            .active_pid
            .lock()
            .map_err(|_| "Failed to lock process state".to_string())?;
        if active_pid.is_some() {
            return Err("An agent process is already running.".to_string());
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        let mut child = Command::new(repo_root.join("pi-test.sh"))
            .current_dir(&repo_root)
            .arg("--no-session")
            .arg("--print")
            .arg(&prompt)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn BlenderAgent CLI: {e}"))?;

        {
            let state: State<'_, AppState> = app.state();
            let mut active_pid = state
                .active_pid
                .lock()
                .map_err(|_| "Failed to lock process state".to_string())?;
            *active_pid = Some(child.id());
        }

        // Stream stderr in a background thread so stdout doesn't block
        let stderr_app = app.clone();
        let stderr_handle = if let Some(stderr) = child.stderr.take() {
            let handle = std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().flatten() {
                    let _ = stderr_app.emit(
                        "agent-chunk",
                        AgentChunk {
                            text: line,
                            channel: "stderr".to_string(),
                        },
                    );
                }
            });
            Some(handle)
        } else {
            None
        };

        // Stream stdout on this thread
        if let Some(stdout) = child.stdout.take() {
            for line in BufReader::new(stdout).lines().flatten() {
                let _ = app.emit(
                    "agent-chunk",
                    AgentChunk {
                        text: line,
                        channel: "stdout".to_string(),
                    },
                );
            }
        }

        if let Some(handle) = stderr_handle {
            let _ = handle.join();
        }

        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for process: {e}"))?;

        {
            let state: State<'_, AppState> = app.state();
            let mut active_pid = state
                .active_pid
                .lock()
                .map_err(|_| "Failed to lock process state".to_string())?;
            *active_pid = None;
        }

        let _ = app.emit(
            "agent-done",
            AgentDone {
                exit_code: status.code().unwrap_or(-1),
                repo_root: repo_root_str,
            },
        );

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task panicked: {e}"))??;

    Ok(())
}

#[tauri::command]
fn stop_agent_run(state: State<'_, AppState>) -> Result<bool, String> {
    let active_pid = state
        .active_pid
        .lock()
        .map_err(|_| "Failed to lock process state".to_string())?;

    let Some(pid) = *active_pid else {
        return Ok(false);
    };

    let status = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .status()
        .map_err(|error| format!("Failed to stop BlenderAgent process: {error}"))?;

    if !status.success() {
        return Err(format!("Failed to stop BlenderAgent process {pid}."));
    }

    Ok(true)
}

#[tauri::command]
fn get_render_previews(repo_path: Option<String>) -> Result<Option<RenderPreviewResult>, String> {
    let repo_root = if let Some(path) = repo_path {
        PathBuf::from(path)
    } else {
        default_repo_root()?
    };

    validate_repo_root(&repo_root)?;

    let Some(manifest) = latest_workspace_manifest(&repo_root)? else {
        return Ok(None);
    };

    let workspace_path = manifest.workspace_path.clone();
    let previews = manifest
        .render_outputs
        .into_iter()
        .filter(|output| Path::new(&output.path).exists())
        .map(|output| RenderPreview {
            workspace_path: workspace_path.clone(),
            image_path: output.path,
            view: output.view,
            iteration: output.iteration,
            created_at: output.created_at,
        })
        .collect::<Vec<_>>();

    Ok(Some(RenderPreviewResult {
        workspace_path,
        previews,
    }))
}

#[tauri::command]
fn run_agent_prompt(prompt: String, repo_path: Option<String>) -> Result<AgentResponse, String> {
    let repo_root = if let Some(path) = repo_path {
        PathBuf::from(path)
    } else {
        default_repo_root()?
    };

    validate_repo_root(&repo_root)?;

    let output = Command::new(repo_root.join("pi-test.sh"))
        .current_dir(&repo_root)
        .arg("--no-session")
        .arg("--print")
        .arg(&prompt)
        .output()
        .map_err(|error| format!("Failed to run BlenderAgent CLI: {error}"))?;

    let exit_code = output.status.code().unwrap_or(-1);

    Ok(AgentResponse {
        prompt,
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        exit_code,
        repo_root: repo_root.display().to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            launch_blender,
            run_agent_stream,
            run_agent_prompt,
            stop_agent_run,
            get_render_previews
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

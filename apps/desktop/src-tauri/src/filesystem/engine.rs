use crate::models::CommandResult;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const API_HOST: &str = "127.0.0.1";
const API_PORT: &str = "5181";
const APP_DIR_NAME: &str = "app";
const RUNTIME_DIR_NAME: &str = "runtime";
const NODE_DIR_NAME: &str = "node";
const PYTHON_DIR_NAME: &str = "python";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub struct InternalEngine(Mutex<Option<Child>>);

// Tauri returns extended-length Windows paths (for example, `\\\\?\\D:\\...`) for
// portable resources. Node.js cannot resolve a script passed in that form.
#[cfg(windows)]
pub fn regular_windows_path(path: PathBuf) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(rest) = raw.strip_prefix("\\\\?\\UNC\\") {
        PathBuf::from(format!("\\\\{}", rest))
    } else if let Some(rest) = raw.strip_prefix("\\\\?\\") {
        PathBuf::from(rest)
    } else {
        path
    }
}

#[cfg(not(windows))]
pub fn regular_windows_path(path: PathBuf) -> PathBuf {
    path
}

fn terminate_process_tree(process: &mut Child) {
    #[cfg(windows)]
    {
        let process_id = process.id().to_string();
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &process_id, "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }

    #[cfg(not(windows))]
    {
        let _ = process.kill();
    }

    let _ = process.wait();
}

impl Drop for InternalEngine {
    fn drop(&mut self) {
        if let Ok(mut child) = self.0.lock() {
            if let Some(process) = child.as_mut() {
                terminate_process_tree(process);
            }
        }
    }
}

pub fn packaged_portable_dir(app: &AppHandle) -> CommandResult<Option<PathBuf>> {
    let portable_dir = regular_windows_path(
        app.path()
            .resource_dir()
            .map_err(|error| error.to_string())?,
    );

    if portable_dir.join(APP_DIR_NAME).is_dir() && portable_dir.join(RUNTIME_DIR_NAME).is_dir() {
        return Ok(Some(portable_dir));
    }

    // `tauri dev` uses the separately started local server. A portable build
    // always has this directory, regardless of the Cargo assertion profile.
    if cfg!(debug_assertions) {
        return Ok(None);
    }

    Err("便携包缺少 app 或 runtime 文件夹。请完整解压 ScholarScope 压缩包。".to_string())
}

fn engine_log_path(app: &AppHandle) -> CommandResult<PathBuf> {
    let directory = regular_windows_path(
        app.path()
            .app_local_data_dir()
            .map_err(|error| error.to_string())?,
    );
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;

    let log_path = directory.join("internal-engine.log");
    let mut log_file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .map_err(|error| format!("无法创建内部引擎日志：{error}"))?;
    writeln!(log_file, "[ScholarScope] Starting internal engine.")
        .map_err(|error| format!("无法写入内部引擎日志：{error}"))?;
    Ok(log_path)
}

fn append_engine_log(log_path: &Path, message: &str) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if let Ok(mut log_file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(log_file, "[{timestamp}] {message}");
    }
}

fn engine_log_stdio(log_path: &Path) -> CommandResult<Stdio> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map(Stdio::from)
        .map_err(|error| format!("无法打开内部引擎日志：{error}"))
}

fn spawn_internal_engine(app: &AppHandle, portable_dir: &Path) -> CommandResult<Child> {
    let portable_dir = regular_windows_path(portable_dir.to_path_buf());
    let app_dir = portable_dir.join(APP_DIR_NAME);
    let runtime_dir = portable_dir.join(RUNTIME_DIR_NAME);
    let node = runtime_dir.join(NODE_DIR_NAME).join("node.exe");
    let server = app_dir.join("server.mjs");
    let log_path = engine_log_path(app)?;
    append_engine_log(
        &log_path,
        &format!(
            "Portable directory: {}. App: {}. Node: {}. Server: {}.",
            portable_dir.display(),
            app_dir.display(),
            node.display(),
            server.display()
        ),
    );

    if !server.exists() {
        append_engine_log(&log_path, "Server module was not found.");
        return Err(
            "便携包缺少 app 文件夹中的内部应用资源。请完整解压 ScholarScope 压缩包。".to_string(),
        );
    }
    if !node.exists() {
        append_engine_log(&log_path, "Bundled Node.js executable was not found.");
        return Err(
            "便携包缺少内部 Node.js 运行时。请重新下载并完整解压 ScholarScope 压缩包。".to_string(),
        );
    }

    let data_dir = regular_windows_path(
        app.path()
            .app_data_dir()
            .map_err(|error| error.to_string())?,
    )
    .join("scholarscope-data");
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;

    let mut command = Command::new(node);
    command
        .arg(&server)
        .current_dir(&app_dir)
        .env("SCHOLARSCOPE_API_HOST", API_HOST)
        .env("SCHOLARSCOPE_API_PORT", API_PORT)
        .env("SCHOLARSCOPE_API_ONLY", "1")
        .env("SCHOLARSCOPE_DATA_DIR", &data_dir)
        .env("SCANSCI_PDF_DATA_DIR", &data_dir)
        .stdin(Stdio::null());

    let embedded_python = runtime_dir.join(PYTHON_DIR_NAME).join(if cfg!(windows) {
        "python.exe"
    } else {
        "bin/python"
    });
    if !embedded_python.exists() {
        append_engine_log(&log_path, "Bundled Python executable was not found.");
        return Err(
            "便携包缺少内部 Python 下载引擎。请重新下载并完整解压 ScholarScope 压缩包。"
                .to_string(),
        );
    }
    append_engine_log(
        &log_path,
        &format!("Python: {}.", embedded_python.display()),
    );
    command
        .env("SCHOLARSCOPE_ENGINE_PYTHON", embedded_python)
        .stdout(engine_log_stdio(&log_path)?)
        .stderr(engine_log_stdio(&log_path)?);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    match command.spawn() {
        Ok(child) => {
            append_engine_log(
                &log_path,
                &format!("Node process started with PID {}.", child.id()),
            );
            Ok(child)
        }
        Err(error) => {
            append_engine_log(&log_path, &format!("Failed to start Node process: {error}"));
            Err(format!("启动内部下载引擎失败：{error}"))
        }
    }
}

pub fn start_internal_engine(app: &AppHandle) -> CommandResult<InternalEngine> {
    let engine = match packaged_portable_dir(app)? {
        Some(portable_dir) => Some(spawn_internal_engine(app, &portable_dir)?),
        None => None,
    };
    Ok(InternalEngine(Mutex::new(engine)))
}

pub fn stop_internal_engine(app: &AppHandle) {
    if let Some(state) = app.try_state::<InternalEngine>() {
        if let Ok(mut child) = state.0.lock() {
            if let Some(process) = child.as_mut() {
                terminate_process_tree(process);
            }
            *child = None;
        }
    }
}

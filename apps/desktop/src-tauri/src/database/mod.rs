use crate::filesystem::regular_windows_path;
use crate::models::CommandResult;
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const INITIAL_SCHEMA: &str = include_str!("../../migrations/0001_initial.sql");

fn db_path(app: &AppHandle) -> CommandResult<PathBuf> {
    let dir = regular_windows_path(
        app.path()
            .app_data_dir()
            .map_err(|error| error.to_string())?,
    );
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("athena-scholar.sqlite3"))
}

pub fn connect(app: &AppHandle) -> CommandResult<Connection> {
    Connection::open(db_path(app)?).map_err(|error| error.to_string())
}

pub fn migrate(connection: &Connection) -> CommandResult<()> {
    connection
        .execute_batch(INITIAL_SCHEMA)
        .map_err(|error| error.to_string())
}

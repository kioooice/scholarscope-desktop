mod commands;
mod filesystem;
mod models;

use commands::download::{get_default_download_directory, save_pdf_file};
use filesystem::{start_internal_engine, stop_internal_engine};
use tauri::{Manager, RunEvent};

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(start_internal_engine(&app.handle())?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_default_download_directory,
            save_pdf_file
        ])
        .build(tauri::generate_context!())
        .expect("error while running ScholarScope");

    app.run(|app, event| {
        if matches!(event, RunEvent::Exit) {
            stop_internal_engine(app);
        }
    });
}

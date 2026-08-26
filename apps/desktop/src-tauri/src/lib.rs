mod commands;
mod database;
mod filesystem;
mod models;
mod services;

use commands::download::save_pdf_file;
use commands::scholarly::{agent_call_ai_chat, agent_fetch_scholarly_text, agent_search_openalex};
use commands::storage::{
    clear_saved_research_data, delete_paper, initialize_database, load_graph, load_notes,
    load_papers, save_graph, save_note, save_paper,
};
use filesystem::{start_internal_engine, stop_internal_engine};
use tauri::{Manager, RunEvent};

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(start_internal_engine(&app.handle())?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_pdf_file,
            initialize_database,
            clear_saved_research_data,
            agent_search_openalex,
            agent_fetch_scholarly_text,
            agent_call_ai_chat,
            save_paper,
            load_papers,
            delete_paper,
            save_graph,
            load_graph,
            save_note,
            load_notes
        ])
        .build(tauri::generate_context!())
        .expect("error while running Athena Scholar");

    app.run(|app, event| {
        if matches!(event, RunEvent::Exit) {
            stop_internal_engine(app);
        }
    });
}

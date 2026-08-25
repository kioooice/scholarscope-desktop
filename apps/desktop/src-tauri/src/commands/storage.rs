use crate::database::{connect, migrate};
use crate::models::{AthenaGraph, AthenaNote, CommandResult, GraphEdge, GraphNode, Paper};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

fn to_json<T: Serialize>(value: &T) -> CommandResult<String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

fn from_json<T: for<'de> Deserialize<'de>>(value: String) -> CommandResult<T> {
    serde_json::from_str(&value).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn initialize_database(app: AppHandle) -> CommandResult<()> {
    let connection = connect(&app)?;
    migrate(&connection)
}

#[tauri::command]
pub fn clear_saved_research_data(app: AppHandle) -> CommandResult<()> {
    let connection = connect(&app)?;
    migrate(&connection)?;
    connection
        .execute_batch(
            r#"
            DELETE FROM paper_authors;
            DELETE FROM paper_topics;
            DELETE FROM paper_concepts;
            DELETE FROM graph_edges;
            DELETE FROM graph_nodes;
            DELETE FROM notes;
            DELETE FROM papers;
            DELETE FROM authors;
            DELETE FROM topics;
            DELETE FROM concepts;
            "#,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_paper(app: AppHandle, paper: Paper) -> CommandResult<Paper> {
    let connection = connect(&app)?;
    migrate(&connection)?;
    connection
        .execute(
            r#"
            INSERT INTO papers (
              id, openalex_id, doi, title, abstract, year, journal, citation_count,
              publisher_url, oa_url, pdf_url, is_open_access, metadata_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT(id) DO UPDATE SET
              openalex_id = excluded.openalex_id,
              doi = excluded.doi,
              title = excluded.title,
              abstract = excluded.abstract,
              year = excluded.year,
              journal = excluded.journal,
              citation_count = excluded.citation_count,
              publisher_url = excluded.publisher_url,
              oa_url = excluded.oa_url,
              pdf_url = excluded.pdf_url,
              is_open_access = excluded.is_open_access,
              metadata_json = excluded.metadata_json
            "#,
            params![
                &paper.id,
                &paper.openalex_id,
                &paper.doi,
                &paper.title,
                &paper.abstract_text,
                &paper.year,
                &paper.journal,
                &paper.citation_count,
                &paper.publisher_url,
                &paper.oa_url,
                &paper.pdf_url,
                if paper.is_open_access { 1 } else { 0 },
                to_json(&paper)?
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(paper)
}

#[tauri::command]
pub fn load_papers(app: AppHandle) -> CommandResult<Vec<Paper>> {
    let connection = connect(&app)?;
    migrate(&connection)?;
    let mut statement = connection
        .prepare("SELECT metadata_json FROM papers ORDER BY created_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;

    rows.map(|row| row.map_err(|error| error.to_string()).and_then(from_json))
        .collect()
}

#[tauri::command]
pub fn delete_paper(app: AppHandle, id: String) -> CommandResult<bool> {
    let connection = connect(&app)?;
    migrate(&connection)?;
    connection
        .execute(
            "DELETE FROM paper_authors WHERE paper_id = ?1",
            params![&id],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM paper_topics WHERE paper_id = ?1", params![&id])
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM paper_concepts WHERE paper_id = ?1",
            params![&id],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM papers WHERE id = ?1", params![&id])
        .map(|count| count > 0)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_graph(app: AppHandle, graph: AthenaGraph) -> CommandResult<AthenaGraph> {
    let mut connection = connect(&app)?;
    migrate(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM graph_edges", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM graph_nodes", [])
        .map_err(|error| error.to_string())?;

    for node in &graph.nodes {
        transaction
            .execute(
                "INSERT INTO graph_nodes (id, type, label, ref_id, metadata_json, x, y) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    &node.id,
                    &node.node_type,
                    &node.label,
                    &node.ref_id,
                    node.metadata.to_string(),
                    &node.x,
                    &node.y
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    for edge in &graph.edges {
        transaction
            .execute(
                "INSERT INTO graph_edges (id, source_node_id, target_node_id, relationship_type, metadata_json) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    &edge.id,
                    &edge.source_node_id,
                    &edge.target_node_id,
                    &edge.relationship_type,
                    edge.metadata.to_string()
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(graph)
}

#[tauri::command]
pub fn load_graph(app: AppHandle) -> CommandResult<AthenaGraph> {
    let connection = connect(&app)?;
    migrate(&connection)?;
    let mut node_statement = connection
        .prepare("SELECT id, type, label, ref_id, metadata_json, x, y FROM graph_nodes")
        .map_err(|error| error.to_string())?;
    let nodes = node_statement
        .query_map([], |row| {
            let metadata: String = row.get(4)?;
            Ok(GraphNode {
                id: row.get(0)?,
                node_type: row.get(1)?,
                label: row.get(2)?,
                ref_id: row.get(3)?,
                metadata: serde_json::from_str(&metadata)
                    .unwrap_or(serde_json::Value::Object(Default::default())),
                x: row.get(5)?,
                y: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let mut edge_statement = connection
        .prepare("SELECT id, source_node_id, target_node_id, relationship_type, metadata_json FROM graph_edges")
        .map_err(|error| error.to_string())?;
    let edges = edge_statement
        .query_map([], |row| {
            let metadata: String = row.get(4)?;
            Ok(GraphEdge {
                id: row.get(0)?,
                source_node_id: row.get(1)?,
                target_node_id: row.get(2)?,
                relationship_type: row.get(3)?,
                metadata: serde_json::from_str(&metadata)
                    .unwrap_or(serde_json::Value::Object(Default::default())),
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(AthenaGraph { nodes, edges })
}

#[tauri::command]
pub fn save_note(app: AppHandle, note: AthenaNote) -> CommandResult<AthenaNote> {
    let connection = connect(&app)?;
    migrate(&connection)?;
    connection
        .execute(
            r#"
            INSERT INTO notes (id, title, content, created_at, updated_at, metadata_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              content = excluded.content,
              updated_at = excluded.updated_at,
              metadata_json = excluded.metadata_json
            "#,
            params![
                &note.id,
                &note.title,
                &note.content,
                &note.created_at,
                &note.updated_at,
                to_json(&note)?
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(note)
}

#[tauri::command]
pub fn load_notes(app: AppHandle) -> CommandResult<Vec<AthenaNote>> {
    let connection = connect(&app)?;
    migrate(&connection)?;
    let mut statement = connection
        .prepare("SELECT metadata_json FROM notes ORDER BY updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;

    rows.map(|row| row.map_err(|error| error.to_string()).and_then(from_json))
        .collect()
}

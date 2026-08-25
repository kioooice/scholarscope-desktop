use rusqlite::{params, Connection};
use reqwest::Url;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, RETRY_AFTER};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const API_HOST: &str = "127.0.0.1";
const API_PORT: &str = "5181";
const RUNTIME_DIR_NAME: &str = ".scholarscope-runtime";
const RESOURCE_DIR_NAME: &str = "resources";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct InternalEngine(Mutex<Option<Child>>);

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

type CommandResult<T> = Result<T, String>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchFilters {
    disciplines: Vec<String>,
    open_access_only: bool,
    min_year: Option<i64>,
    max_year: Option<i64>,
    min_citations: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchRequest {
    query: String,
    #[serde(rename = "type")]
    search_type: String,
    filters: SearchFilters,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchHeader {
    name: String,
    value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiChatRequest {
    url: String,
    api_key: Option<String>,
    payload: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Paper {
    id: String,
    openalex_id: Option<String>,
    doi: Option<String>,
    title: String,
    authors: Vec<String>,
    #[serde(rename = "abstract")]
    abstract_text: Option<String>,
    journal: Option<String>,
    year: Option<i64>,
    publisher: Option<String>,
    citation_count: i64,
    publisher_url: Option<String>,
    oa_url: Option<String>,
    pdf_url: Option<String>,
    is_open_access: bool,
    source_provider: String,
    concepts: Vec<String>,
    topics: Vec<String>,
    keywords: Vec<String>,
    references: Vec<String>,
    related_papers: Vec<String>,
    date_added: Option<String>,
    favorite: Option<bool>,
    tags: Option<Vec<String>>,
    notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphNode {
    id: String,
    #[serde(rename = "type")]
    node_type: String,
    label: String,
    ref_id: Option<String>,
    metadata: serde_json::Value,
    x: Option<f64>,
    y: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphEdge {
    id: String,
    source_node_id: String,
    target_node_id: String,
    relationship_type: String,
    metadata: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AthenaGraph {
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AthenaNote {
    id: String,
    title: String,
    content: String,
    linked_node_ids: Vec<String>,
    created_at: String,
    updated_at: String,
}

fn db_path(app: &AppHandle) -> CommandResult<PathBuf> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("athena-scholar.sqlite3"))
}

fn packaged_runtime_dir(app: &AppHandle) -> CommandResult<PathBuf> {
    Ok(app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join(RESOURCE_DIR_NAME)
        .join(RUNTIME_DIR_NAME))
}

fn spawn_internal_engine(app: &AppHandle) -> CommandResult<Child> {
    let packaged_root = packaged_runtime_dir(app)?;
    let node = packaged_root.join("node.exe");
    let server = packaged_root.join("server.mjs");

    if !server.exists() {
        return Err("便携包缺少 resources 文件夹中的内部下载引擎。请完整解压 ScholarScope 压缩包。".to_string());
    }
    if !node.exists() {
        return Err("便携包缺少内部 Node.js 运行时。请重新下载并完整解压 ScholarScope 压缩包。".to_string());
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("scholarscope-data");
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;

    let mut command = Command::new(node);
    command
        .arg(&server)
        .current_dir(&packaged_root)
        .env("SCHOLARSCOPE_API_HOST", API_HOST)
        .env("SCHOLARSCOPE_API_PORT", API_PORT)
        .env("SCHOLARSCOPE_API_ONLY", "1")
        .env("SCHOLARSCOPE_DATA_DIR", &data_dir)
        .env("SCANSCI_PDF_DATA_DIR", &data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let embedded_python = packaged_root.join(".scansci-runtime").join(if cfg!(windows) {
        "python.exe"
    } else {
        "bin/python"
    });
    if !embedded_python.exists() {
        return Err("便携包缺少内部 Python 下载引擎。请重新下载并完整解压 ScholarScope 压缩包。".to_string());
    }
    command.env("SCHOLARSCOPE_ENGINE_PYTHON", embedded_python);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command
        .spawn()
        .map_err(|error| format!("启动内部下载引擎失败：{error}"))
}

fn stop_internal_engine(app: &AppHandle) {
    if let Some(state) = app.try_state::<InternalEngine>() {
        if let Ok(mut child) = state.0.lock() {
            if let Some(process) = child.as_mut() {
                terminate_process_tree(process);
            }
            *child = None;
        }
    }
}

fn connect(app: &AppHandle) -> CommandResult<Connection> {
    Connection::open(db_path(app)?).map_err(|error| error.to_string())
}

fn to_json<T: Serialize>(value: &T) -> CommandResult<String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

fn from_json<T: for<'de> Deserialize<'de>>(value: String) -> CommandResult<T> {
    serde_json::from_str(&value).map_err(|error| error.to_string())
}

fn value_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key).and_then(|item| item.as_str()).map(ToOwned::to_owned)
}

fn nested_string(value: &serde_json::Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().map(ToOwned::to_owned)
}

fn nested_bool(value: &serde_json::Value, path: &[&str]) -> bool {
    let mut current = value;
    for key in path {
        if let Some(next) = current.get(*key) {
            current = next;
        } else {
            return false;
        }
    }
    current.as_bool().unwrap_or(false)
}

fn normalize_doi(doi: Option<String>) -> Option<String> {
    doi.map(|value| {
        value
            .trim()
            .trim_start_matches("https://doi.org/")
            .trim_start_matches("http://doi.org/")
            .to_string()
    })
}

fn rebuild_openalex_abstract(value: &serde_json::Value) -> String {
    let Some(index) = value.get("abstract_inverted_index").and_then(|item| item.as_object()) else {
        return "No abstract was provided by OpenAlex for this work.".to_string();
    };

    let mut words: Vec<(i64, String)> = Vec::new();
    for (word, positions) in index {
        if let Some(items) = positions.as_array() {
            for position in items {
                if let Some(position) = position.as_i64() {
                    words.push((position, word.to_string()));
                }
            }
        }
    }

    words.sort_by_key(|(position, _)| *position);
    words
        .into_iter()
        .map(|(_, word)| word)
        .collect::<Vec<_>>()
        .join(" ")
}

fn string_array(value: &serde_json::Value, path: &[&str], child_key: Option<&str>, limit: usize) -> Vec<String> {
    let mut current = value;
    for key in path {
        if let Some(next) = current.get(*key) {
            current = next;
        } else {
            return Vec::new();
        }
    }

    current
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| match child_key {
                    Some(key) => value_string(item, key),
                    None => item.as_str().map(ToOwned::to_owned),
                })
                .take(limit)
                .collect()
        })
        .unwrap_or_default()
}

fn openalex_work_to_paper(work: &serde_json::Value) -> Paper {
    let authors = work
        .get("authorships")
        .and_then(|items| items.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| nested_string(item, &["author", "display_name"]))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let concepts = string_array(work, &["concepts"], Some("display_name"), 10);
    let topics = string_array(work, &["topics"], Some("display_name"), 8);
    let keywords = concepts
        .iter()
        .chain(topics.iter())
        .take(8)
        .cloned()
        .collect::<Vec<_>>();
    let open_access = nested_bool(work, &["open_access", "is_oa"]) || nested_bool(work, &["primary_location", "is_oa"]);
    Paper {
        id: value_string(work, "id").unwrap_or_else(|| value_string(work, "doi").unwrap_or_else(|| "openalex-unknown".to_string())),
        openalex_id: value_string(work, "id"),
        doi: normalize_doi(value_string(work, "doi")),
        title: value_string(work, "title")
            .or_else(|| value_string(work, "display_name"))
            .unwrap_or_else(|| "Untitled work".to_string()),
        authors,
        abstract_text: Some(rebuild_openalex_abstract(work)),
        journal: nested_string(work, &["primary_location", "source", "display_name"]),
        year: work.get("publication_year").and_then(|item| item.as_i64()),
        publisher: nested_string(work, &["primary_location", "source", "display_name"]),
        citation_count: work.get("cited_by_count").and_then(|item| item.as_i64()).unwrap_or(0),
        publisher_url: nested_string(work, &["primary_location", "landing_page_url"]),
        oa_url: nested_string(work, &["open_access", "oa_url"]),
        pdf_url: nested_string(work, &["primary_location", "pdf_url"]),
        is_open_access: open_access,
        source_provider: "OpenAlex".to_string(),
        concepts,
        topics,
        keywords,
        references: string_array(work, &["referenced_works"], None, 8),
        related_papers: string_array(work, &["related_works"], None, 8),
        date_added: None,
        favorite: None,
        tags: None,
        notes: None,
    }
}

fn openalex_filter(request: &SearchRequest) -> Option<String> {
    let mut filters = Vec::new();
    if request.filters.open_access_only {
        filters.push("is_oa:true".to_string());
    }
    if let Some(year) = request.filters.min_year {
        filters.push(format!("from_publication_date:{year}-01-01"));
    }
    if let Some(year) = request.filters.max_year {
        filters.push(format!("to_publication_date:{year}-12-31"));
    }
    if let Some(citations) = request.filters.min_citations {
        filters.push(format!("cited_by_count:>{citations}"));
    }
    if filters.is_empty() {
        None
    } else {
        Some(filters.join(","))
    }
}

fn clean_provider_query(query: &str) -> String {
    query
        .chars()
        .map(|character| {
            if "?!.:,;()[]{}".contains(character) {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn provider_query(request: &SearchRequest) -> String {
    let query = clean_provider_query(&request.query);
    match request.search_type.as_str() {
        "topic" | "keywords" if !request.filters.disciplines.is_empty() => {
            format!("{} {}", query, request.filters.disciplines.join(" "))
        }
        _ => query,
    }
}

fn is_allowed_scholarly_host(url: &Url) -> bool {
    matches!(
        url.host_str(),
        Some("api.openalex.org")
            | Some("api.crossref.org")
            | Some("www.bing.com")
            | Some("eutils.ncbi.nlm.nih.gov")
            | Some("api.semanticscholar.org")
            | Some("export.arxiv.org")
            | Some("api.unpaywall.org")
            | Some("api.openaire.eu")
    )
}

fn is_local_ai_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn is_allowed_ai_endpoint(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    if is_local_ai_host(host) {
        return matches!(url.scheme(), "http" | "https");
    }
    url.scheme() == "https"
}

fn request_headers(headers: Option<Vec<FetchHeader>>) -> CommandResult<HeaderMap> {
    let mut map = HeaderMap::new();
    for header in headers.unwrap_or_default() {
        let normalized = header.name.to_ascii_lowercase();
        if normalized != "x-api-key" {
            continue;
        }
        let name = HeaderName::from_bytes(normalized.as_bytes()).map_err(|error| error.to_string())?;
        let value = HeaderValue::from_str(&header.value).map_err(|error| error.to_string())?;
        map.insert(name, value);
    }
    Ok(map)
}

fn scholarly_client() -> CommandResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("ScholarScope/0.1 (desktop scholarly search)")
        .build()
        .map_err(|error| error.to_string())
}

fn migrate(connection: &Connection) -> CommandResult<()> {
    connection
        .execute_batch(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS papers (
              id TEXT PRIMARY KEY,
              openalex_id TEXT,
              doi TEXT,
              title TEXT NOT NULL,
              abstract TEXT,
              year INTEGER,
              journal TEXT,
              citation_count INTEGER NOT NULL DEFAULT 0,
              publisher_url TEXT,
              oa_url TEXT,
              pdf_url TEXT,
              is_open_access INTEGER NOT NULL DEFAULT 0,
              metadata_json TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS authors (
              id TEXT PRIMARY KEY,
              openalex_id TEXT,
              name TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS topics (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS concepts (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              description TEXT
            );

            CREATE TABLE IF NOT EXISTS notes (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              metadata_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS graph_nodes (
              id TEXT PRIMARY KEY,
              type TEXT NOT NULL,
              label TEXT NOT NULL,
              ref_id TEXT,
              metadata_json TEXT NOT NULL,
              x REAL,
              y REAL
            );

            CREATE TABLE IF NOT EXISTS graph_edges (
              id TEXT PRIMARY KEY,
              source_node_id TEXT NOT NULL,
              target_node_id TEXT NOT NULL,
              relationship_type TEXT NOT NULL,
              metadata_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS paper_authors (
              paper_id TEXT NOT NULL,
              author_id TEXT NOT NULL,
              PRIMARY KEY (paper_id, author_id)
            );

            CREATE TABLE IF NOT EXISTS paper_topics (
              paper_id TEXT NOT NULL,
              topic_id TEXT NOT NULL,
              PRIMARY KEY (paper_id, topic_id)
            );

            CREATE TABLE IF NOT EXISTS paper_concepts (
              paper_id TEXT NOT NULL,
              concept_id TEXT NOT NULL,
              PRIMARY KEY (paper_id, concept_id)
            );
            "#,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn initialize_database(app: AppHandle) -> CommandResult<()> {
    let connection = connect(&app)?;
    migrate(&connection)
}

#[tauri::command]
fn clear_saved_research_data(app: AppHandle) -> CommandResult<()> {
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
async fn agent_search_openalex(request: SearchRequest) -> CommandResult<Vec<Paper>> {
    let mut params = vec![
        ("per-page".to_string(), "25".to_string()),
    ];

    match request.search_type.as_str() {
        "doi" => params.push(("filter".to_string(), format!("doi:{}", request.query.trim()))),
        "author" => {
            let query = provider_query(&request);
            params.push(("search".to_string(), query.clone()));
            let author_filter = format!("authorships.author.search:{}", query);
            let filter = [Some(author_filter), openalex_filter(&request)]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(",");
            params.push(("filter".to_string(), filter));
        }
        "title" => params.push(("search.title".to_string(), request.query.clone())),
        _ => params.push(("search".to_string(), provider_query(&request))),
    }

    if request.search_type != "author" && request.search_type != "doi" {
        if let Some(filter) = openalex_filter(&request) {
            params.push(("filter".to_string(), filter));
        }
    }

    let url = Url::parse_with_params("https://api.openalex.org/works", params).map_err(|error| error.to_string())?;
    let payload = scholarly_client()?
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;

    Ok(payload
        .get("results")
        .and_then(|items| items.as_array())
        .map(|items| items.iter().map(openalex_work_to_paper).collect())
        .unwrap_or_default())
}

#[tauri::command]
async fn agent_fetch_scholarly_text(url: String, headers: Option<Vec<FetchHeader>>) -> CommandResult<String> {
    let url = Url::parse(&url).map_err(|error| error.to_string())?;
    if !is_allowed_scholarly_host(&url) {
        return Err("Host is not on ScholarScope's scholarly provider allowlist".to_string());
    }

    let response = scholarly_client()?
        .get(url)
        .headers(request_headers(headers)?)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get(RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let detail = response
            .text()
            .await
            .unwrap_or_default()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(240)
            .collect::<String>();
        let mut message = format!("Provider request failed: {status}");
        if let Some(retry_after) = retry_after {
            message.push_str(&format!("; retry-after={retry_after}"));
        }
        if !detail.is_empty() {
            message.push_str(&format!("; {detail}"));
        }
        return Err(message);
    }

    response
        .text()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn agent_call_ai_chat(request: AiChatRequest) -> CommandResult<String> {
    let url = Url::parse(&request.url).map_err(|error| error.to_string())?;
    if !is_allowed_ai_endpoint(&url) {
        return Err("AI endpoint must be HTTPS or a local Ollama-compatible HTTP server".to_string());
    }

    let mut builder = reqwest::Client::new()
        .post(url)
        .header("content-type", "application/json");

    if let Some(api_key) = request.api_key.filter(|value| !value.trim().is_empty()) {
        builder = builder.bearer_auth(api_key.trim());
    }

    builder
        .json(&request.payload)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .text()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_paper(app: AppHandle, paper: Paper) -> CommandResult<Paper> {
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
fn load_papers(app: AppHandle) -> CommandResult<Vec<Paper>> {
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
fn delete_paper(app: AppHandle, id: String) -> CommandResult<bool> {
    let connection = connect(&app)?;
    migrate(&connection)?;
    connection
        .execute("DELETE FROM paper_authors WHERE paper_id = ?1", params![&id])
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM paper_topics WHERE paper_id = ?1", params![&id])
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM paper_concepts WHERE paper_id = ?1", params![&id])
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM papers WHERE id = ?1", params![&id])
        .map(|count| count > 0)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_graph(app: AppHandle, graph: AthenaGraph) -> CommandResult<AthenaGraph> {
    let mut connection = connect(&app)?;
    migrate(&connection)?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction.execute("DELETE FROM graph_edges", []).map_err(|error| error.to_string())?;
    transaction.execute("DELETE FROM graph_nodes", []).map_err(|error| error.to_string())?;

    for node in &graph.nodes {
        transaction
            .execute(
                "INSERT INTO graph_nodes (id, type, label, ref_id, metadata_json, x, y) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![&node.id, &node.node_type, &node.label, &node.ref_id, node.metadata.to_string(), &node.x, &node.y],
            )
            .map_err(|error| error.to_string())?;
    }

    for edge in &graph.edges {
        transaction
            .execute(
                "INSERT INTO graph_edges (id, source_node_id, target_node_id, relationship_type, metadata_json) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![&edge.id, &edge.source_node_id, &edge.target_node_id, &edge.relationship_type, edge.metadata.to_string()],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(graph)
}

#[tauri::command]
fn load_graph(app: AppHandle) -> CommandResult<AthenaGraph> {
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
                metadata: serde_json::from_str(&metadata).unwrap_or(serde_json::Value::Object(Default::default())),
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
                metadata: serde_json::from_str(&metadata).unwrap_or(serde_json::Value::Object(Default::default())),
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(AthenaGraph { nodes, edges })
}

#[tauri::command]
fn save_note(app: AppHandle, note: AthenaNote) -> CommandResult<AthenaNote> {
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
            params![&note.id, &note.title, &note.content, &note.created_at, &note.updated_at, to_json(&note)?],
        )
        .map_err(|error| error.to_string())?;
    Ok(note)
}

#[tauri::command]
fn load_notes(app: AppHandle) -> CommandResult<Vec<AthenaNote>> {
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

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let engine = if cfg!(debug_assertions) {
                None
            } else {
                Some(spawn_internal_engine(&app.handle())?)
            };
            app.manage(InternalEngine(Mutex::new(engine)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            stop_internal_engine(app);
        }
    });
}

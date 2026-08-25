use serde::{Deserialize, Serialize};

pub type CommandResult<T> = Result<T, String>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFilters {
    pub disciplines: Vec<String>,
    pub open_access_only: bool,
    pub min_year: Option<i64>,
    pub max_year: Option<i64>,
    pub min_citations: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,
    #[serde(rename = "type")]
    pub search_type: String,
    pub filters: SearchFilters,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub url: String,
    pub api_key: Option<String>,
    pub payload: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Paper {
    pub id: String,
    pub openalex_id: Option<String>,
    pub doi: Option<String>,
    pub title: String,
    pub authors: Vec<String>,
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    pub journal: Option<String>,
    pub year: Option<i64>,
    pub publisher: Option<String>,
    pub citation_count: i64,
    pub publisher_url: Option<String>,
    pub oa_url: Option<String>,
    pub pdf_url: Option<String>,
    pub is_open_access: bool,
    pub source_provider: String,
    pub concepts: Vec<String>,
    pub topics: Vec<String>,
    pub keywords: Vec<String>,
    pub references: Vec<String>,
    pub related_papers: Vec<String>,
    pub date_added: Option<String>,
    pub favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub label: String,
    pub ref_id: Option<String>,
    pub metadata: serde_json::Value,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub source_node_id: String,
    pub target_node_id: String,
    pub relationship_type: String,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AthenaGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AthenaNote {
    pub id: String,
    pub title: String,
    pub content: String,
    pub linked_node_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

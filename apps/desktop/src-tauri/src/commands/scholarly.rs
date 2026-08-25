use crate::models::{AiChatRequest, CommandResult, FetchHeader, Paper, SearchRequest};
use crate::services::scholarly;

#[tauri::command]
pub async fn agent_search_openalex(request: SearchRequest) -> CommandResult<Vec<Paper>> {
    scholarly::search_openalex(request).await
}

#[tauri::command]
pub async fn agent_fetch_scholarly_text(
    url: String,
    headers: Option<Vec<FetchHeader>>,
) -> CommandResult<String> {
    scholarly::fetch_scholarly_text(url, headers).await
}

#[tauri::command]
pub async fn agent_call_ai_chat(request: AiChatRequest) -> CommandResult<String> {
    scholarly::call_ai_chat(request).await
}

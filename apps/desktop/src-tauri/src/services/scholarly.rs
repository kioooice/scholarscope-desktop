use crate::models::{AiChatRequest, CommandResult, FetchHeader, Paper, SearchRequest};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, RETRY_AFTER};
use reqwest::Url;
use std::time::Duration;

fn value_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .map(ToOwned::to_owned)
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
    let Some(index) = value
        .get("abstract_inverted_index")
        .and_then(|item| item.as_object())
    else {
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

fn string_array(
    value: &serde_json::Value,
    path: &[&str],
    child_key: Option<&str>,
    limit: usize,
) -> Vec<String> {
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
    let open_access = nested_bool(work, &["open_access", "is_oa"])
        || nested_bool(work, &["primary_location", "is_oa"]);
    Paper {
        id: value_string(work, "id").unwrap_or_else(|| {
            value_string(work, "doi").unwrap_or_else(|| "openalex-unknown".to_string())
        }),
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
        citation_count: work
            .get("cited_by_count")
            .and_then(|item| item.as_i64())
            .unwrap_or(0),
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
        let name =
            HeaderName::from_bytes(normalized.as_bytes()).map_err(|error| error.to_string())?;
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

pub async fn search_openalex(request: SearchRequest) -> CommandResult<Vec<Paper>> {
    let mut params = vec![("per-page".to_string(), "25".to_string())];

    match request.search_type.as_str() {
        "doi" => params.push((
            "filter".to_string(),
            format!("doi:{}", request.query.trim()),
        )),
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

    let url = Url::parse_with_params("https://api.openalex.org/works", params)
        .map_err(|error| error.to_string())?;
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

pub async fn fetch_scholarly_text(
    url: String,
    headers: Option<Vec<FetchHeader>>,
) -> CommandResult<String> {
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

    response.text().await.map_err(|error| error.to_string())
}

pub async fn call_ai_chat(request: AiChatRequest) -> CommandResult<String> {
    let url = Url::parse(&request.url).map_err(|error| error.to_string())?;
    if !is_allowed_ai_endpoint(&url) {
        return Err(
            "AI endpoint must be HTTPS or a local Ollama-compatible HTTP server".to_string(),
        );
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

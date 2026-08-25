"""Private paper engine worker used by ScholarScope.

The worker owns the ScanSci source implementations but does not expose their
web or MCP interfaces. Node talks to this process over JSON Lines. Locate
requests only resolve metadata and source URLs; the PDF downloader runs only
for an explicit download request.
"""

from __future__ import annotations

import importlib
import json
import os
import re
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

import requests


DOI_RE = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/)?(10\.\d{4,9}/\S+)$", re.I)
DEFAULT_SOURCE_COUNT = 13


def clean_doi(value: str | None) -> str | None:
    if not value:
        return None
    match = DOI_RE.match(value.strip())
    if not match:
        return None
    return match.group(1).rstrip(".,;)").lower()


def strip_tags(value: Any) -> str:
    if not isinstance(value, str):
        return "No abstract was provided by Crossref for this work."
    text = re.sub(r"<[^>]+>", " ", value)
    text = re.sub(r"\s+", " ", text).strip()
    return text or "No abstract was provided by Crossref for this work."


def normalized_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\u4e00-\u9fff]+", " ", value.lower())).strip()


def year_from_work(work: dict[str, Any]) -> int | None:
    for key in ("published-print", "published-online", "published", "created"):
        date = work.get(key)
        if isinstance(date, dict):
            parts = date.get("date-parts")
            if isinstance(parts, list) and parts and isinstance(parts[0], list) and parts[0]:
                try:
                    return int(parts[0][0])
                except (TypeError, ValueError):
                    pass
    return None


def author_name(author: Any) -> str | None:
    if not isinstance(author, dict):
        return None
    value = " ".join(str(author.get(key, "")).strip() for key in ("given", "family") if author.get(key)).strip()
    return value or (str(author.get("name")).strip() if author.get("name") else None)


def paper_from_crossref(work: dict[str, Any]) -> dict[str, Any]:
    doi = clean_doi(str(work.get("DOI", "")))
    title = next((item.strip() for item in work.get("title", []) if isinstance(item, str) and item.strip()), "Untitled Crossref work")
    subjects = [str(item).strip() for item in work.get("subject", []) if str(item).strip()][:8]
    links = work.get("link", [])
    if not isinstance(links, list):
        links = [links]
    pdf_url = None
    for link in links:
        if isinstance(link, dict) and "pdf" in str(link.get("content-type", "")).lower() and link.get("URL"):
            pdf_url = str(link["URL"])
            break
    publisher_url = str(work.get("URL") or (f"https://doi.org/{doi}" if doi else "")) or None
    has_open_license = any(
        isinstance(license_item, dict)
        and re.search(r"creativecommons\.org|publicdomain", str(license_item.get("URL", "")), re.I)
        for license_item in (work.get("license") or [])
    )
    return {
        "id": f"crossref:{doi}" if doi else f"crossref:{re.sub(r'[^a-z0-9]+', '-', title.lower())[:80]}",
        "doi": doi,
        "title": title,
        "authors": [name for name in (author_name(item) for item in (work.get("author") or [])) if name],
        "abstract": strip_tags(work.get("abstract")),
        "journal": next((str(item).strip() for item in (work.get("container-title") or []) if str(item).strip()), None),
        "year": year_from_work(work),
        "publisher": str(work.get("publisher")) if work.get("publisher") else None,
        "citationCount": int(work.get("is-referenced-by-count") or 0),
        "publisherUrl": publisher_url,
        "oaUrl": pdf_url if pdf_url and has_open_license else None,
        "pdfUrl": pdf_url,
        "isOpenAccess": bool(pdf_url and has_open_license),
        "sourceProvider": "Crossref",
        "concepts": subjects,
        "topics": subjects,
        "keywords": subjects,
        "references": [
            str(reference.get("DOI") or reference.get("article-title"))
            for reference in (work.get("reference") or [])
            if isinstance(reference, dict) and (reference.get("DOI") or reference.get("article-title"))
        ][:8],
        "relatedPapers": [],
    }


def request_crossref(url: str, email: str, timeout: float) -> dict[str, Any]:
    params = {"mailto": email} if email else {}
    response = requests.get(
        url,
        params=params,
        headers={"Accept": "application/json", "User-Agent": "ScholarScope/0.1"},
        timeout=timeout,
    )
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, dict) else {}


def crossref_search(payload: dict[str, Any]) -> list[dict[str, Any]]:
    message = payload.get("message")
    if not isinstance(message, dict):
        return []
    items = message.get("items")
    if isinstance(items, list):
        return [paper_from_crossref(item) for item in items if isinstance(item, dict)]
    if isinstance(message.get("DOI"), str):
        return [paper_from_crossref(message)]
    return []


def abstract_from_openalex(work: dict[str, Any]) -> str:
    inverted = work.get("abstract_inverted_index")
    if not isinstance(inverted, dict):
        return "No abstract was provided by OpenAlex for this work."
    words: list[tuple[int, str]] = []
    for word, positions in inverted.items():
        if isinstance(word, str) and isinstance(positions, list):
            words.extend((int(position), word) for position in positions if isinstance(position, int))
    words.sort(key=lambda item: item[0])
    return " ".join(word for _, word in words) or "No abstract was provided by OpenAlex for this work."


def paper_from_openalex(work: dict[str, Any]) -> dict[str, Any]:
    raw_doi = work.get("doi") or ""
    doi = clean_doi(str(raw_doi))
    title = str(work.get("title") or "Untitled OpenAlex work").strip()
    authors: list[str] = []
    for authorship in work.get("authorships") or []:
        if isinstance(authorship, dict):
            author = authorship.get("author")
            if isinstance(author, dict) and author.get("display_name"):
                authors.append(str(author["display_name"]))
    primary = work.get("primary_location") if isinstance(work.get("primary_location"), dict) else {}
    best_oa = work.get("best_oa_location") if isinstance(work.get("best_oa_location"), dict) else {}
    pdf_url = best_oa.get("pdf_url") or primary.get("pdf_url")
    landing_url = best_oa.get("landing_page_url") or primary.get("landing_page_url") or work.get("id")
    concepts = [str(item.get("display_name")) for item in (work.get("concepts") or []) if isinstance(item, dict) and item.get("display_name")][:8]
    return {
        "id": f"openalex:{doi}" if doi else f"openalex:{re.sub(r'[^a-z0-9]+', '-', title.lower())[:80]}",
        "openalexId": str(work.get("id")) if work.get("id") else None,
        "doi": doi,
        "title": title,
        "authors": authors,
        "abstract": abstract_from_openalex(work),
        "journal": (primary.get("source") or {}).get("display_name") if isinstance(primary.get("source"), dict) else None,
        "year": work.get("publication_year"),
        "publisher": ((primary.get("source") or {}).get("host_organization_name") if isinstance(primary.get("source"), dict) else None),
        "citationCount": int(work.get("cited_by_count") or 0),
        "publisherUrl": landing_url,
        "oaUrl": pdf_url or landing_url if work.get("open_access", {}).get("is_oa") else None,
        "pdfUrl": pdf_url,
        "isOpenAccess": bool(work.get("open_access", {}).get("is_oa") and (pdf_url or landing_url)),
        "sourceProvider": "OpenAlex",
        "concepts": concepts,
        "topics": concepts,
        "keywords": concepts,
        "references": [],
        "relatedPapers": [],
    }


def request_openalex(url: str, email: str, timeout: float) -> dict[str, Any]:
    params = {"mailto": email} if email else {}
    response = requests.get(
        url,
        params=params,
        headers={"Accept": "application/json", "User-Agent": "ScholarScope/0.1"},
        timeout=timeout,
    )
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, dict) else {}


def openalex_search(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if isinstance(payload.get("results"), list):
        return [paper_from_openalex(item) for item in payload["results"] if isinstance(item, dict)]
    if payload.get("id") or payload.get("doi"):
        return [paper_from_openalex(payload)]
    return []


def fetch_metadata_parallel(query: str, email: str, timeout: float) -> list[dict[str, Any]]:
    doi = clean_doi(query)
    if doi:
        crossref_url = f"https://api.crossref.org/works/{quote(doi, safe='')}"
        openalex_url = f"https://api.openalex.org/works/doi:{quote(doi, safe='')}"
    else:
        crossref_url = "https://api.crossref.org/works"
        openalex_url = "https://api.openalex.org/works"

    def get_crossref() -> list[dict[str, Any]]:
        if doi:
            return crossref_search(request_crossref(crossref_url, email, timeout))
        response = requests.get(
            crossref_url,
            params={"query.bibliographic": query, "rows": "12", "sort": "relevance", **({"mailto": email} if email else {})},
            headers={"Accept": "application/json", "User-Agent": "ScholarScope/0.1"},
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
        return crossref_search(payload if isinstance(payload, dict) else {})

    def get_openalex() -> list[dict[str, Any]]:
        if doi:
            return openalex_search(request_openalex(openalex_url, email, timeout))
        response = requests.get(
            openalex_url,
            params={"search": query, "per-page": "12", **({"mailto": email} if email else {})},
            headers={"Accept": "application/json", "User-Agent": "ScholarScope/0.1"},
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
        return openalex_search(payload if isinstance(payload, dict) else {})

    results: list[dict[str, Any]] = []
    errors: list[Exception] = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(get_crossref), pool.submit(get_openalex)]
        for future in as_completed(futures):
            try:
                results.extend(future.result())
            except Exception as exc:
                errors.append(exc)
    if not results and errors:
        raise errors[0]
    return results


def search_papers(request: dict[str, Any]) -> dict[str, Any]:
    query = str(request.get("query") or "").strip()
    if not query:
        return {"papers": [], "diagnostic": {"status": "error", "error": "请输入检索词"}}

    email = str(request.get("email") or "").strip()
    timeout = max(2.0, min(float(request.get("timeoutMs") or 15000) / 1000, 60.0))
    doi = clean_doi(query)
    started = time.monotonic()
    papers = fetch_metadata_parallel(query, email, timeout)

    min_citations = int((request.get("filters") or {}).get("minCitations") or 0)
    if min_citations:
        papers = [paper for paper in papers if int(paper.get("citationCount") or 0) >= min_citations]
    if (request.get("filters") or {}).get("openAccessOnly"):
        papers = [paper for paper in papers if paper.get("isOpenAccess")]
    min_year = int((request.get("filters") or {}).get("minYear") or 0)
    max_year = int((request.get("filters") or {}).get("maxYear") or 9999)
    if min_year or max_year < 9999:
        papers = [paper for paper in papers if paper.get("year") is None or min_year <= int(paper["year"]) <= max_year]
    duration = round((time.monotonic() - started) * 1000)
    return {
        "papers": papers,
        "diagnostic": {"status": "success", "resultCount": len(papers), "durationMs": duration, "metadataSources": ["Crossref", "OpenAlex"]},
    }


class ProbeRecorder:
    """Collect candidate URLs while ScanSci source functions are running.

    ScanSci source functions normally pass candidate URLs to download_pdf.
    Replacing that function with this recorder lets us reuse the source logic
    without creating a PDF during locate.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._local = threading.local()
        self._candidates: list[dict[str, Any]] = []

    def set_source(self, source: str) -> None:
        self._local.source = source

    def source(self, fallback: str = "下载引擎") -> str:
        return str(getattr(self._local, "source", fallback))

    def add(self, url: Any, source: str | None = None, is_pdf: bool | None = None, kind: str = "pdf") -> None:
        if not isinstance(url, str) or not re.match(r"^https?://", url, re.I):
            return
        item = {
            "source": source or self.source(),
            "url": url,
            "isPdf": bool(is_pdf if is_pdf is not None else re.search(r"\.pdf(?:$|[?#])", url, re.I)),
            "kind": kind,
            "foundAt": time.monotonic(),
        }
        with self._lock:
            if not any(candidate["source"] == item["source"] and candidate["url"] == item["url"] for candidate in self._candidates):
                self._candidates.append(item)

    def candidates(self) -> list[dict[str, Any]]:
        with self._lock:
            return sorted(self._candidates, key=lambda item: item["foundAt"])


class PatchSet:
    def __init__(self) -> None:
        self._originals: list[tuple[Any, str, Any]] = []

    def replace(self, module: Any, name: str, value: Any) -> None:
        if not hasattr(module, name):
            return
        self._originals.append((module, name, getattr(module, name)))
        setattr(module, name, value)

    def restore(self) -> None:
        for module, name, value in reversed(self._originals):
            setattr(module, name, value)
        self._originals.clear()


def source_modules() -> list[Any]:
    modules = []
    for module_name, module in list(sys.modules.items()):
        if module_name.startswith("scansci_pdf.sources") or module_name in {
            "scansci_pdf.pdf_utils",
            "scansci_pdf.browser_engine",
            "scansci_pdf.publisher_strategies",
        }:
            if module is not None:
                modules.append(module)
    return modules


def install_probe_patches(patches: PatchSet, recorder: ProbeRecorder) -> None:
    pdf_utils = importlib.import_module("scansci_pdf.pdf_utils")
    publishers = importlib.import_module("scansci_pdf.sources.publishers")
    strategies = importlib.import_module("scansci_pdf.publisher_strategies")
    browser_engine = importlib.import_module("scansci_pdf.browser_engine")

    def probe_download(url: str, output_path: Path, config: dict[str, Any], source: str, **_: Any) -> dict[str, Any]:
        recorder.add(url, source=source, kind="pdf", is_pdf=True)
        return {"success": True, "file": str(output_path), "source": source}

    for module in source_modules():
        if hasattr(module, "download_pdf"):
            patches.replace(module, "download_pdf", probe_download)
    patches.replace(pdf_utils, "download_pdf", probe_download)

    def probe_http(url: str, *_: Any, **__: Any) -> bool:
        recorder.add(url, kind="pdf", is_pdf=True)
        return True

    def probe_browser(*args: Any, **kwargs: Any) -> bool:
        url = args[1] if len(args) > 1 and isinstance(args[1], str) else kwargs.get("article_url")
        recorder.add(url, kind="landing", is_pdf=False)
        return False

    def probe_browser_pdf(url: str, *_: Any, **__: Any) -> bool:
        recorder.add(url, kind="pdf", is_pdf=True)
        return False

    patches.replace(strategies, "_try_http_download", probe_http)
    patches.replace(strategies, "_browser_download_with_fallback", probe_browser)
    patches.replace(strategies, "_browser_download", probe_browser)
    patches.replace(strategies, "_browser_download_visible", probe_browser)
    patches.replace(browser_engine, "download_pdf_via_browser", probe_browser_pdf)
    patches.replace(publishers, "_write_pdf_atomic", lambda *_args, **_kwargs: False)

    scihub = importlib.import_module("scansci_pdf.sources.scihub")

    def probe_scihub_browser(landing_url: str, *_: Any, **__: Any) -> None:
        recorder.add(landing_url, source="Sci-Hub", kind="landing", is_pdf=False)
        return None

    patches.replace(scihub, "_browser_first_download", probe_scihub_browser)
    patches.replace(scihub, "_race_browser_domains", lambda *_args, **_kwargs: None)
    patches.replace(scihub, "_response_looks_pdf", lambda *_args, **_kwargs: False)


def locate_sources(doi: str, request: dict[str, Any]) -> dict[str, Any]:
    from scansci_pdf.config import load_config
    from scansci_pdf.sources import _build_free_sources

    config = load_config().copy()
    settings = request.get("settings") if isinstance(request.get("settings"), dict) else {}
    if settings.get("email"):
        config["email"] = str(settings["email"]).strip()
    if settings.get("scihubEnabled") is not None:
        config["scihub_enabled"] = bool(settings["scihubEnabled"])
    config["download_strategy"] = str(settings.get("strategy") or "fastest")
    config["request_delay_min"] = 0.0
    config["request_delay_max"] = 0.0
    config["fixed_request_delay_enabled"] = False

    source_pairs = _build_free_sources(doi, config)
    source_names = [label for _, label in source_pairs]
    recorder = ProbeRecorder()
    patches = PatchSet()
    install_probe_patches(patches, recorder)
    probe_dir = Path(tempfile.gettempdir()) / "scholarscope-locate"
    probe_dir.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()

    def run_source(source_fn: Callable[..., Any], label: str) -> None:
        recorder.set_source(label)
        output_path = probe_dir / f"{os.getpid()}_{threading.get_ident()}_{label}.pdf"
        try:
            source_fn(doi, output_path, config)
        except Exception:
            # A failing source is recorded by the caller through the absence
            # of a candidate; one source must not prevent the remaining race.
            pass

    try:
        with ThreadPoolExecutor(max_workers=max(1, min(len(source_pairs), 16))) as pool:
            futures = [pool.submit(run_source, source_fn, label) for source_fn, label in source_pairs]
            deadline = time.monotonic() + max(5.0, min(float(request.get("timeoutMs") or 20000) / 1000, 90.0))
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception:
                    pass
                if time.monotonic() >= deadline:
                    for pending in futures:
                        pending.cancel()
                    break
    finally:
        patches.restore()

    candidates = recorder.candidates()
    # Remove internal timestamps before crossing the process boundary.
    for candidate in candidates:
        candidate.pop("foundAt", None)
    route = candidates[0] if candidates else None
    return {
        "status": "found" if route else "not-found",
        "identifier": doi,
        "route": route,
        "routes": candidates[:8],
        "checkedSources": len(source_names),
        "totalSources": len(source_names) or DEFAULT_SOURCE_COUNT,
        "sourceNames": source_names,
        "durationMs": round((time.monotonic() - started) * 1000),
    }


def resolve_identifier(request: dict[str, Any]) -> tuple[str | None, dict[str, Any] | None]:
    identifier = str(request.get("identifier") or request.get("title") or "").strip()
    doi = clean_doi(identifier)
    if doi:
        return doi, None
    if not identifier:
        return None, {"status": "error", "error": "缺少论文题名或 DOI"}
    result = search_papers({
        "query": identifier,
        "filters": {},
        "email": request.get("email"),
        "timeoutMs": request.get("timeoutMs"),
    })
    papers = result.get("papers") or []
    candidates = [paper for paper in papers if paper.get("doi")]
    if not candidates:
        return None, {"status": "not-found", "error": "元数据检索未能从题名解析 DOI"}
    selected = max(
        candidates,
        key=lambda paper: (
            SequenceMatcher(None, normalized_text(identifier), normalized_text(str(paper.get("title") or ""))).ratio(),
            int(paper.get("citationCount") or 0),
        ),
    )
    return str(selected["doi"]), None


def locate(request: dict[str, Any]) -> dict[str, Any]:
    doi, error = resolve_identifier(request)
    if error:
        return error
    assert doi
    result = locate_sources(doi, request)
    result["requestedIdentifier"] = str(request.get("identifier") or request.get("title") or doi).strip()
    return result


def download_paper(request: dict[str, Any]) -> dict[str, Any]:
    from scansci_pdf.sources import download

    doi, error = resolve_identifier(request)
    if error:
        return error
    assert doi
    settings = request.get("settings") if isinstance(request.get("settings"), dict) else {}
    result = download(
        doi,
        output_dir=request.get("outputDir"),
        scihub_enabled=settings.get("scihubEnabled"),
        use_tor=bool(settings.get("useTor", False)),
        strategy=str(settings.get("strategy") or "fastest"),
    )
    if not isinstance(result, dict):
        return {"status": "error", "error": "下载引擎返回了无效结果"}
    if result.get("success"):
        return {
            "status": "downloaded",
            "identifier": doi,
            "source": result.get("source") or "下载引擎",
            "filePath": str(result.get("file") or ""),
        }
    return {
        "status": "error",
        "identifier": doi,
        "error": str(result.get("error") or result.get("message") or "未能下载该文献"),
        "source": result.get("source"),
    }


def status() -> dict[str, Any]:
    try:
        from scansci_pdf.config import load_config
        from scansci_pdf.sources import _build_free_sources

        config = load_config().copy()
        names = [label for _, label in _build_free_sources("10.0000/status", config)]
        return {"status": "ready", "sourceCount": len(names) or DEFAULT_SOURCE_COUNT, "sources": names}
    except Exception as exc:
        return {"status": "error", "error": str(exc), "sourceCount": DEFAULT_SOURCE_COUNT}


def handle(request: dict[str, Any]) -> dict[str, Any]:
    method = request.get("method")
    if method == "status":
        return status()
    if method == "search":
        return search_papers(request)
    if method == "locate":
        return locate(request)
    if method == "download":
        return download_paper(request)
    return {"status": "error", "error": f"未知引擎请求：{method}"}


def main() -> None:
    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id") if isinstance(request, dict) else None
            response = handle(request if isinstance(request, dict) else {})
        except Exception as exc:
            response = {"status": "error", "error": str(exc)}
        envelope = {"id": request_id, "result": response}
        # Keep the pipe ASCII-safe on Windows locales such as GBK. The Node
        # client decodes the JSON escapes back to the original Unicode text.
        sys.stdout.write(json.dumps(envelope, ensure_ascii=True, separators=(",", ":")) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()

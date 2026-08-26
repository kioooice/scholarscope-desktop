"""Private paper engine worker used by ScholarScope.

The worker owns the ScanSci source implementations but does not expose their
web or MCP interfaces. Node talks to this process over JSON Lines. Locate
requests resolve metadata and verify lightweight source responses; the full
PDF downloader runs only for an explicit download request.
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
from concurrent.futures import ThreadPoolExecutor, as_completed, wait
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urlparse

import requests


DOI_RE = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/)?(10\.\d{4,9}/\S+)$", re.I)
DEFAULT_SOURCE_COUNT = 13
LOCATE_PROBE_TIMEOUT_SECONDS = 8.0
LOCATE_MAX_CANDIDATES = 8
SOURCE_PRIORITY = {
    "plosdirect": 0,
    "unpaywall": 1,
    "openalexoa": 2,
    "semanticscholar": 3,
    "doaj": 4,
    "crossrefpage": 5,
    "europepmc": 6,
    "pmc": 7,
    "core": 8,
    "scibban": 30,
    "libgen": 31,
    "sci-hub": 32,
}


def clean_doi(value: str | None) -> str | None:
    if not value:
        return None
    match = DOI_RE.match(value.strip())
    if not match:
        return None
    return match.group(1).rstrip(".,;)").lower()


def bounded_timeout_seconds(
    request: dict[str, Any],
    *,
    default_seconds: float,
    minimum_seconds: float,
    maximum_seconds: float,
) -> float:
    try:
        requested = float(request.get("timeoutMs") or default_seconds * 1000) / 1000
    except (TypeError, ValueError):
        requested = default_seconds
    return max(minimum_seconds, min(requested, maximum_seconds))


def apply_source_limits(config: dict[str, Any], request: dict[str, Any], timeout_seconds: float) -> dict[str, Any]:
    settings = request.get("settings") if isinstance(request.get("settings"), dict) else {}
    if settings.get("email"):
        config["email"] = str(settings["email"]).strip()
    if settings.get("scihubEnabled") is not None:
        config["scihub_enabled"] = bool(settings["scihubEnabled"])
    config["download_strategy"] = str(settings.get("strategy") or "fastest")
    config["request_delay_min"] = 0.0
    config["request_delay_max"] = 0.0
    config["fixed_request_delay_enabled"] = False
    config["connect_timeout"] = max(3, min(10, int(timeout_seconds // 4) or 3))
    config["read_timeout"] = max(5, min(20, int(timeout_seconds // 2) or 5))
    # Tor setup can block for minutes while fetching its own runtime. It must
    # be an explicit setting rather than an automatic fallback for a desktop click.
    config["use_tor_for_scihub"] = settings.get("useTor") is True
    return settings


def located_route(request: dict[str, Any]) -> dict[str, Any] | None:
    route = request.get("route")
    if not isinstance(route, dict):
        return None
    url = route.get("url")
    if not isinstance(url, str) or not url.strip():
        return None
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return {
        "source": str(route.get("source") or "下载来源").strip()[:120] or "下载来源",
        "url": url.strip(),
        "isPdf": route.get("isPdf") is True,
    }


def candidate_output_path(doi: str, output_dir: Any, config: dict[str, Any]) -> Path:
    target_dir = Path(output_dir) if isinstance(output_dir, str) and output_dir.strip() else Path(str(config.get("output_dir") or tempfile.gettempdir()))
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = re.sub(r"[^A-Za-z0-9._-]+", "_", doi).strip("._")[:180] or "paper"
    return target_dir / f"{filename}.pdf"


def safe_url_for_log(url: Any) -> str:
    """Keep diagnostics useful without dumping long signed query strings."""
    if not isinstance(url, str):
        return ""
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return url[:240]
    path = parsed.path or "/"
    if len(path) > 180:
        path = f"{path[:177]}..."
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def response_failure_detail(
    *,
    url: str,
    status_code: int | None = None,
    content_type: str = "",
    sample: bytes = b"",
    error: Exception | None = None,
) -> str:
    """Build a short diagnostic that can be shown in the engine log/UI."""
    if error is not None:
        return f"{type(error).__name__}: {str(error)[:180]}"
    sample_text = re.sub(r"\s+", " ", sample[:240].decode("utf-8", errors="replace")).strip()
    detail = f"HTTP {status_code}" if status_code is not None else "无 HTTP 状态"
    if content_type:
        detail += f", Content-Type {content_type[:100]}"
    if sample_text:
        detail += f", 响应片段 {sample_text[:180]}"
    return detail


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
            def candidate_key(item: dict[str, Any]) -> tuple[int, int, float]:
                source = str(item.get("source") or "").lower()
                priority = next((value for name, value in SOURCE_PRIORITY.items() if source == name or source.startswith(f"{name}(")), 20)
                return (0 if item.get("isPdf") else 1, priority, float(item["foundAt"]))

            return sorted(self._candidates, key=candidate_key)


def engine_log(message: str, level: str = "INFO") -> None:
    """Write engine diagnostics to stderr, which the desktop app persists."""
    print(f"[{level}] {message}", file=sys.stderr, flush=True)


def verify_candidate_url(
    candidate: dict[str, Any],
    config: dict[str, Any],
    timeout_seconds: float,
) -> dict[str, Any]:
    """Perform a small streamed request before exposing a PDF candidate.

    Source implementations often obtain a URL from metadata and return it
    before the URL has been checked. A signed repository URL can expire between
    those two steps, so locating must reject HTTP errors and non-PDF bodies.
    """
    from scansci_pdf.network import fetch

    checked = dict(candidate)
    url = str(candidate.get("url") or "")
    started = time.monotonic()
    probe_config = dict(config)
    probe_config["connect_timeout"] = max(2, min(int(timeout_seconds), int(LOCATE_PROBE_TIMEOUT_SECONDS)))
    probe_config["read_timeout"] = max(3, min(int(timeout_seconds), int(LOCATE_PROBE_TIMEOUT_SECONDS)))
    response: requests.Response | None = None
    try:
        response = fetch(
            url,
            probe_config,
            headers={"Accept": "application/pdf,*/*"},
            stream=True,
        )
        content_type = response.headers.get("content-type", "")
        first_chunk = next(response.iter_content(chunk_size=4096), b"")
        status_code = int(response.status_code)
        looks_pdf = first_chunk.startswith(b"%PDF-")
        checked["probe"] = {
            "statusCode": status_code,
            "contentType": content_type[:120],
            "looksPdf": looks_pdf,
            "durationMs": round((time.monotonic() - started) * 1000),
        }
        detail = response_failure_detail(
            url=url,
            status_code=status_code,
            content_type=content_type,
            sample=first_chunk,
        )
        # A missing object is definitive and must not reach the UI. Access
        # challenges, rate limits, and transient 5xx/timeouts are different:
        # the URL may work on an explicit download retry, so retain it as an
        # unverified fallback with its diagnostic attached.
        missing_object = status_code in {404, 410} or any(
            marker in first_chunk[:2048].lower()
            for marker in (b"blobnotfound", b"nosuchkey", b"filenotfound", b"not found")
        )
        if status_code >= 400 and not missing_object:
            checked["isPdf"] = True
            checked["probeStatus"] = "unverified"
            checked["probeError"] = detail
        elif status_code >= 400:
            checked["isPdf"] = False
            checked["probeStatus"] = "rejected"
            checked["probeError"] = detail
        elif not looks_pdf:
            checked["isPdf"] = False
            checked["probeStatus"] = "rejected"
            checked["probeError"] = detail
        else:
            checked["isPdf"] = True
            checked["probeStatus"] = "verified"
        return checked
    except Exception as exc:
        checked["isPdf"] = True
        checked["probeStatus"] = "unverified"
        checked["probe"] = {
            "durationMs": round((time.monotonic() - started) * 1000),
        }
        checked["probeError"] = response_failure_detail(url=url, error=exc)
        return checked
    finally:
        if response is not None:
            response.close()


def verify_pdf_candidates(
    candidates: list[dict[str, Any]],
    config: dict[str, Any],
    timeout_seconds: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int, int]:
    pdf_candidates = [item for item in candidates if item.get("isPdf")]
    landing_candidates = [item for item in candidates if not item.get("isPdf")]
    if not pdf_candidates:
        return [], landing_candidates, 0, 0

    per_candidate_timeout = max(2.0, min(LOCATE_PROBE_TIMEOUT_SECONDS, timeout_seconds / max(1, min(len(pdf_candidates), 4))))
    verified: list[dict[str, Any]] = []
    unverified: list[dict[str, Any]] = []
    candidate_order = {(item.get("source"), item.get("url")): index for index, item in enumerate(pdf_candidates)}
    pool = ThreadPoolExecutor(max_workers=min(len(pdf_candidates), 4))
    future_map = {
        pool.submit(verify_candidate_url, item, config, per_candidate_timeout): item
        for item in pdf_candidates
    }
    try:
        done, pending = wait(future_map, timeout=max(2.0, min(LOCATE_PROBE_TIMEOUT_SECONDS, timeout_seconds)))
        for future in done:
            candidate = future_map[future]
            try:
                checked = future.result()
            except Exception as exc:
                checked = {**candidate, "isPdf": True, "probeStatus": "unverified", "probeError": response_failure_detail(url=str(candidate.get("url") or ""), error=exc)}
            if checked.get("isPdf"):
                if checked.get("probeStatus") == "verified":
                    verified.append(checked)
                else:
                    unverified.append(checked)
                    engine_log(
                        f"locate kept unverified {checked.get('source') or 'source'} {safe_url_for_log(checked.get('url'))}: {checked.get('probeError') or 'probe incomplete'}",
                        "WARN",
                    )
            else:
                engine_log(
                    f"locate rejected {checked.get('source') or 'source'} {safe_url_for_log(checked.get('url'))}: {checked.get('probeError') or 'not a PDF'}",
                    "WARN",
                )
        for future in pending:
            candidate = future_map[future]
            unverified.append({
                **candidate,
                "isPdf": True,
                "probeStatus": "unverified",
                "probeError": f"候选校验超时（>{per_candidate_timeout:.1f}s）",
            })
            engine_log(
                f"locate kept unverified {candidate.get('source') or 'source'} {safe_url_for_log(candidate.get('url'))}: probe timeout",
                "WARN",
            )
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    ordered = sorted(
        verified + unverified,
        key=lambda item: candidate_order.get((item.get("source"), item.get("url")), len(candidate_order)),
    )
    return ordered, landing_candidates, len(verified), len(unverified)


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
    timeout_seconds = bounded_timeout_seconds(
        request,
        default_seconds=20,
        minimum_seconds=5,
        maximum_seconds=45,
    )
    apply_source_limits(config, request, timeout_seconds)

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
        except Exception as exc:
            # One source must not prevent the remaining race, but keep the
            # concrete exception in the persisted engine log.
            engine_log(f"locate source {label} failed: {type(exc).__name__}: {str(exc)[:180]}", "WARN")

    deadline = time.monotonic() + timeout_seconds
    pool = ThreadPoolExecutor(max_workers=max(1, min(len(source_pairs), 16)))
    futures = [pool.submit(run_source, source_fn, label) for source_fn, label in source_pairs]
    try:
        pending = set(futures)
        while pending:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                engine_log(f"locate source budget exhausted after {timeout_seconds:.1f}s", "WARN")
                break
            done, pending = wait(pending, timeout=remaining)
            for future in done:
                try:
                    future.result()
                except Exception as exc:
                    engine_log(f"locate source failed: {type(exc).__name__}: {str(exc)[:160]}", "WARN")
    finally:
        for future in futures:
            future.cancel()
        # A timed-out source is isolated in the per-operation worker process;
        # do not hold the JSON response open while a browser source unwinds.
        pool.shutdown(wait=False, cancel_futures=True)
        patches.restore()

    raw_candidates = recorder.candidates()
    for candidate in raw_candidates:
        candidate.pop("foundAt", None)
    remaining_seconds = max(2.0, min(8.0, deadline - time.monotonic()))
    pdf_candidates, landing_candidates, verified_count, unverified_count = verify_pdf_candidates(raw_candidates, config, remaining_seconds)
    candidates = pdf_candidates + landing_candidates
    route = candidates[0] if candidates else None
    engine_log(
        f"locate {doi}: {verified_count} verified PDF candidate(s), {unverified_count} unverified fallback(s), {len(landing_candidates)} source page(s)",
    )
    return {
        "status": "found" if route else "not-found",
        "identifier": doi,
        "route": route,
        "routes": candidates[:LOCATE_MAX_CANDIDATES],
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


def download_route_pdf(
    url: str,
    output_path: Path,
    config: dict[str, Any],
    source: str,
    *,
    use_tor: bool = False,
) -> dict[str, Any]:
    """Download one user-selected route while preserving HTTP diagnostics."""
    from scansci_pdf.network import fetch
    from scansci_pdf.pdf_utils import is_pdf_file, success

    started = time.monotonic()
    response: requests.Response | None = None
    safe_url = safe_url_for_log(url)
    try:
        engine_log(f"download start source={source} url={safe_url}")
        response = fetch(
            url,
            config,
            headers={"Accept": "application/pdf,*/*"},
            stream=True,
            use_tor=use_tor,
        )
        content_type = response.headers.get("content-type", "")
        iterator = response.iter_content(chunk_size=8192)
        first_chunk = next(iterator, b"")
        status_code = int(response.status_code)
        engine_log(
            f"download response source={source} url={safe_url} status={status_code} content_type={content_type[:100]} first={first_chunk[:12]!r}",
        )
        if status_code >= 400:
            detail = response_failure_detail(
                url=url,
                status_code=status_code,
                content_type=content_type,
                sample=first_chunk,
            )
            engine_log(f"download failed source={source} url={safe_url}: {detail}", "WARN")
            return {"success": False, "source": source, "error": detail, "statusCode": status_code}
        if not first_chunk.startswith(b"%PDF-"):
            detail = response_failure_detail(
                url=url,
                status_code=status_code,
                content_type=content_type,
                sample=first_chunk,
            )
            engine_log(f"download rejected non-PDF source={source} url={safe_url}: {detail}", "WARN")
            return {"success": False, "source": source, "error": f"来源返回的不是 PDF（{detail}）", "statusCode": status_code}

        output_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = output_path.with_suffix(output_path.suffix + ".part")
        try:
            with tmp_path.open("wb") as fh:
                fh.write(first_chunk)
                for chunk in iterator:
                    if chunk:
                        fh.write(chunk)
            tmp_path.replace(output_path)
        except Exception:
            tmp_path.unlink(missing_ok=True)
            raise

        if not is_pdf_file(output_path):
            output_path.unlink(missing_ok=True)
            detail = "响应以 PDF 头开始，但文件校验未通过（可能下载不完整）"
            engine_log(f"download failed source={source} url={safe_url}: {detail}", "WARN")
            return {"success": False, "source": source, "error": detail, "statusCode": status_code}

        result = success(output_path.stem, output_path, source)
        engine_log(
            f"download success source={source} url={safe_url} bytes={output_path.stat().st_size} duration_ms={round((time.monotonic() - started) * 1000)}",
        )
        return result
    except Exception as exc:
        detail = response_failure_detail(url=url, error=exc)
        engine_log(f"download exception source={source} url={safe_url}: {detail}", "WARN")
        return {"success": False, "source": source, "error": detail}
    finally:
        if response is not None:
            response.close()


def download_paper(request: dict[str, Any]) -> dict[str, Any]:
    from scansci_pdf import sources

    doi, error = resolve_identifier(request)
    if error:
        return error
    assert doi
    timeout_seconds = bounded_timeout_seconds(
        request,
        default_seconds=60,
        minimum_seconds=15,
        maximum_seconds=90,
    )
    config = sources.load_config().copy()
    settings = apply_source_limits(config, request, timeout_seconds)
    route = located_route(request)
    if not route:
        return {"status": "error", "identifier": doi, "error": "下载候选已过期，请重新检索来源"}
    if not route["isPdf"]:
        return {
            "status": "error",
            "identifier": doi,
            "source": route["source"],
            "error": "当前候选来源未提供可直接下载的 PDF，请查看来源页面",
        }

    output_path = candidate_output_path(doi, request.get("outputDir"), config)
    # Download exactly the route shown in the UI. Do not start another source
    # race here, otherwise a Sci-Hub/LibGen fallback can replace that route.
    result = download_route_pdf(
        route["url"],
        output_path,
        config,
        route["source"],
        use_tor=settings.get("useTor") is True,
    )
    if not isinstance(result, dict):
        return {
            "status": "error",
            "identifier": doi,
            "source": route["source"],
            "error": "当前候选来源未能返回 PDF，请查看来源页面或稍后重试",
        }
    if result.get("success"):
        return {
            "status": "downloaded",
            "identifier": doi,
            "source": result.get("source") or route["source"],
            "filePath": str(result.get("file") or ""),
        }
    return {
        "status": "error",
        "identifier": doi,
        "source": route["source"],
        "error": str(result.get("error") or result.get("message") or "当前候选来源未能返回 PDF，请查看来源页面或稍后重试"),
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

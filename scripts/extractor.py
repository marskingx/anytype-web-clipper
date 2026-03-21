from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup, Tag

from .models import ExtractionResult

try:
    from readability import Document  # type: ignore
except Exception:
    Document = None


NOISE_TAGS = (
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "canvas",
    "footer",
    "header",
    "nav",
    "aside",
    "form",
    "button",
)

META_TITLE_KEYS = (
    ("property", "og:title"),
    ("name", "twitter:title"),
)

META_DESCRIPTION_KEYS = (
    ("property", "og:description"),
    ("name", "twitter:description"),
    ("name", "description"),
)

META_AUTHOR_KEYS = (
    ("name", "author"),
    ("property", "article:author"),
    ("name", "twitter:creator"),
)

META_DATE_KEYS = (
    ("property", "article:published_time"),
    ("property", "og:published_time"),
    ("name", "pubdate"),
    ("name", "date"),
    ("itemprop", "datePublished"),
)

META_MODIFIED_KEYS = (
    ("property", "article:modified_time"),
    ("property", "og:updated_time"),
    ("itemprop", "dateModified"),
)

META_IMAGE_KEYS = (
    ("property", "og:image"),
    ("name", "twitter:image"),
)

META_CANONICAL_KEYS = (("property", "og:url"),)

META_MEDIA_KEYS = (
    ("property", "og:site_name"),
    ("name", "application-name"),
)

META_CHANNEL_KEYS = (
    ("name", "channel"),
    ("property", "article:section"),
)

META_CONTENT_TYPE_KEYS = (("property", "og:type"),)

META_LANGUAGE_KEYS = (("property", "og:locale"),)

MEDIA_EMBED_HOST_KEYWORDS = (
    "youtube.com",
    "youtu.be",
    "vimeo.com",
    "spotify.com",
    "soundcloud.com",
    "buzzsprout.com",
    "podcasts.apple.com",
)


@dataclass
class Candidate:
    content_html: str
    text_content: str
    image_urls: List[str]
    title: str = ""


def extract_article(url: str, html: str, preferred_title: str = "") -> ExtractionResult:
    soup = BeautifulSoup(html, "html.parser")
    metadata = _extract_metadata(soup, url)
    embedded_urls = _extract_embedded_urls(soup, url)
    _strip_noise(soup)

    readability_candidate = _extract_with_readability(html, url)
    heuristic_candidate = _extract_with_heuristics(soup, url)

    candidate = _pick_best_candidate(readability_candidate, heuristic_candidate)
    content_html = candidate.content_html
    text_content = _normalize_space(candidate.text_content)
    excerpt = metadata.get("description", "") or _build_excerpt(text_content)

    fallback_title = soup.title.get_text(strip=True) if soup.title else ""
    title = (
        preferred_title.strip()
        or candidate.title.strip()
        or metadata.get("title", "").strip()
        or fallback_title
    )
    title = _strip_site_suffix(title)

    source_url = metadata.get("canonical_url") or metadata.get("og_url") or url
    image_urls = candidate.image_urls[:]
    if metadata.get("cover_image_url"):
        cover_url = metadata["cover_image_url"]
        if cover_url not in image_urls:
            image_urls.insert(0, cover_url)

    source_domain = _normalize_domain(source_url)
    cover_image = image_urls[0] if image_urls else metadata.get("cover_image_url", "")
    media_name = metadata.get("media_raw", "").strip() or source_domain

    warnings: List[str] = []
    if readability_candidate is None:
        warnings.append("readability_unavailable_or_failed")
    if len(text_content) < 300:
        warnings.append("short_content_extracted")

    return ExtractionResult(
        url=source_url,
        title=title,
        source_domain=source_domain,
        content_html=content_html,
        text_content=text_content,
        excerpt=excerpt,
        original_url=url,
        author=metadata.get("author_raw", ""),
        author_raw=metadata.get("author_raw", ""),
        media=media_name,
        media_raw=metadata.get("media_raw", ""),
        channel=metadata.get("channel_raw", ""),
        channel_raw=metadata.get("channel_raw", ""),
        media_logo_url=metadata.get("media_logo_url", ""),
        published_at=metadata.get("published_at", ""),
        modified_at=metadata.get("modified_at", ""),
        content_type=metadata.get("content_type", ""),
        language=metadata.get("language", ""),
        cover_image_url=cover_image or "",
        embedded_urls=embedded_urls,
        image_urls=_dedupe_list(image_urls),
        warnings=warnings,
    )


def _strip_noise(soup: BeautifulSoup) -> None:
    for tag_name in NOISE_TAGS:
        for node in soup.find_all(tag_name):
            node.decompose()

    for node in soup.select(
        "[class*='advert'],[class*='banner'],[class*='cookie'],"
        "[id*='advert'],[id*='banner'],[id*='cookie'],"
        ".social-share,.share-buttons,.newsletter"
    ):
        node.decompose()


def _extract_metadata(soup: BeautifulSoup, base_url: str) -> Dict[str, str]:
    data: Dict[str, str] = {}
    jsonld_blocks = _extract_json_ld_blocks(soup)

    canonical_url = _normalize_source_url(
        _extract_canonical_url(soup, base_url)
        or _extract_meta_value(soup, META_CANONICAL_KEYS)
        or "",
        base_url,
    )
    og_url = _normalize_source_url(_extract_meta_value(soup, META_CANONICAL_KEYS), base_url)
    html_lang = str((soup.html and soup.html.get("lang")) or "").strip().lower()

    data["title"] = (
        _extract_json_ld_headline(jsonld_blocks)
        or _extract_meta_value(soup, META_TITLE_KEYS)
    )
    data["description"] = (
        _extract_json_ld_description(jsonld_blocks)
        or _extract_meta_value(soup, META_DESCRIPTION_KEYS)
    )
    data["author_raw"] = (
        _extract_json_ld_author_name(jsonld_blocks)
        or _extract_meta_value(soup, META_AUTHOR_KEYS)
    )
    data["media_raw"] = (
        _extract_json_ld_publisher_name(jsonld_blocks)
        or _extract_meta_value(soup, META_MEDIA_KEYS)
    )
    data["channel_raw"] = (
        _extract_json_ld_article_section(jsonld_blocks)
        or _extract_meta_value(soup, META_CHANNEL_KEYS)
    )
    data["published_at"] = (
        _extract_json_ld_date(jsonld_blocks, "datePublished")
        or _extract_meta_value(soup, META_DATE_KEYS)
    )
    data["modified_at"] = (
        _extract_json_ld_date(jsonld_blocks, "dateModified")
        or _extract_meta_value(soup, META_MODIFIED_KEYS)
    )
    data["cover_image_url"] = _normalize_image_url(
        _extract_json_ld_image_url(jsonld_blocks) or _extract_meta_value(soup, META_IMAGE_KEYS),
        base_url,
    )
    data["media_logo_url"] = _normalize_image_url(
        _extract_json_ld_publisher_logo_url(jsonld_blocks) or _extract_favicon_url(soup, base_url),
        base_url,
    )
    data["content_type"] = (
        _extract_meta_value(soup, META_CONTENT_TYPE_KEYS) or _extract_json_ld_content_type(jsonld_blocks)
    )
    data["language"] = _extract_meta_value(soup, META_LANGUAGE_KEYS) or html_lang
    data["canonical_url"] = canonical_url
    data["og_url"] = og_url
    return data


def _extract_favicon_url(soup: BeautifulSoup, base_url: str) -> str:
    rel_targets = ("icon", "shortcut icon", "apple-touch-icon")
    for node in soup.find_all("link"):
        rel = node.get("rel") or []
        rel_joined = " ".join(str(x).lower() for x in rel)
        if not any(target in rel_joined for target in rel_targets):
            continue
        href = str(node.get("href") or "").strip()
        normalized = _normalize_image_url(href, base_url)
        if normalized:
            return normalized
    return ""


def _extract_meta_value(
    soup: BeautifulSoup,
    keys: tuple[tuple[str, str], ...],
) -> str:
    for attr_name, attr_value in keys:
        found = soup.find("meta", attrs={attr_name: attr_value})
        if found and found.get("content"):
            return str(found["content"]).strip()
    return ""


def _extract_canonical_url(soup: BeautifulSoup, base_url: str) -> str:
    for node in soup.find_all("link"):
        rel = node.get("rel") or []
        rel_joined = " ".join(str(x).lower() for x in rel)
        if "canonical" not in rel_joined:
            continue
        href = str(node.get("href") or "").strip()
        if not href:
            continue
        return _normalize_source_url(href, base_url)
    return ""


def _normalize_source_url(raw_url: str, base_url: str) -> str:
    raw = (raw_url or "").strip()
    if not raw:
        return ""
    if raw.startswith("javascript:") or raw.startswith("#"):
        return ""
    return urljoin(base_url, raw)


def _extract_json_ld_blocks(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    blocks: List[Dict[str, Any]] = []
    for node in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = (node.string or node.get_text() or "").strip()
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
        except Exception:
            continue
        blocks.extend(_expand_json_ld_nodes(parsed))
    return blocks


def _expand_json_ld_nodes(value: Any) -> List[Dict[str, Any]]:
    nodes: List[Dict[str, Any]] = []
    if isinstance(value, list):
        for item in value:
            nodes.extend(_expand_json_ld_nodes(item))
        return nodes
    if not isinstance(value, dict):
        return nodes
    nodes.append(value)
    graph = value.get("@graph")
    if isinstance(graph, list):
        for item in graph:
            nodes.extend(_expand_json_ld_nodes(item))
    elif isinstance(graph, dict):
        nodes.extend(_expand_json_ld_nodes(graph))
    return nodes


def _extract_json_ld_headline(blocks: List[Dict[str, Any]]) -> str:
    for block in blocks:
        for key in ("headline", "name"):
            value = _normalize_json_ld_scalar(block.get(key))
            if value:
                return value
    return ""


def _extract_json_ld_description(blocks: List[Dict[str, Any]]) -> str:
    for block in blocks:
        value = _normalize_json_ld_scalar(block.get("description"))
        if value:
            return value
    return ""


def _extract_json_ld_author_name(blocks: List[Dict[str, Any]]) -> str:
    for block in blocks:
        author_name = _extract_name_from_entity(block.get("author"))
        if author_name:
            return author_name
    return ""


def _extract_json_ld_publisher_name(blocks: List[Dict[str, Any]]) -> str:
    for block in blocks:
        publisher_name = _extract_name_from_entity(block.get("publisher"))
        if publisher_name:
            return publisher_name
    return ""


def _extract_json_ld_article_section(blocks: List[Dict[str, Any]]) -> str:
    for block in blocks:
        value = _normalize_json_ld_scalar(block.get("articleSection"))
        if value:
            return value
    return ""


def _extract_json_ld_date(blocks: List[Dict[str, Any]], key: str) -> str:
    for block in blocks:
        value = _normalize_json_ld_scalar(block.get(key))
        if value:
            return value
    return ""


def _extract_json_ld_image_url(blocks: List[Dict[str, Any]]) -> str:
    for block in blocks:
        url = _extract_url_from_entity(block.get("image"))
        if url:
            return url
    return ""


def _extract_json_ld_publisher_logo_url(blocks: List[Dict[str, Any]]) -> str:
    for block in blocks:
        publisher = block.get("publisher")
        logo = ""
        if isinstance(publisher, dict):
            logo = _extract_url_from_entity(publisher.get("logo"))
        elif isinstance(publisher, list):
            for item in publisher:
                if not isinstance(item, dict):
                    continue
                logo = _extract_url_from_entity(item.get("logo"))
                if logo:
                    break
        if logo:
            return logo
    return ""


def _extract_json_ld_content_type(blocks: List[Dict[str, Any]]) -> str:
    for block in blocks:
        value = block.get("@type")
        normalized = _normalize_json_ld_scalar(value)
        if normalized:
            return normalized
    return ""


def _extract_name_from_entity(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return _normalize_json_ld_scalar(value.get("name"))
    if isinstance(value, list):
        for item in value:
            name = _extract_name_from_entity(item)
            if name:
                return name
    return ""


def _extract_url_from_entity(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        direct = _normalize_json_ld_scalar(value.get("url"))
        if direct:
            return direct
        direct = _normalize_json_ld_scalar(value.get("@id"))
        if direct:
            return direct
    if isinstance(value, list):
        for item in value:
            resolved = _extract_url_from_entity(item)
            if resolved:
                return resolved
    return ""


def _normalize_json_ld_scalar(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        for item in value:
            normalized = _normalize_json_ld_scalar(item)
            if normalized:
                return normalized
    return ""


def _extract_with_readability(html: str, base_url: str) -> Optional[Candidate]:
    if Document is None:
        return None

    try:
        doc = Document(html)
        article_html = doc.summary(html_partial=True)
        if not article_html.strip():
            return None
        article_soup = BeautifulSoup(article_html, "html.parser")
        _strip_noise(article_soup)
        text_content = article_soup.get_text(" ", strip=True)
        image_urls = _extract_images(article_soup, base_url)
        return Candidate(
            content_html=str(article_soup),
            text_content=text_content,
            image_urls=image_urls,
            title=doc.short_title() or "",
        )
    except Exception:
        return None


def _extract_with_heuristics(soup: BeautifulSoup, base_url: str) -> Candidate:
    root: Tag = soup.body if soup.body else soup
    best_node = None
    best_score = -1.0

    candidates = root.find_all(["article", "main", "section", "div"], limit=300)
    for node in candidates:
        score = _score_node(node)
        if score > best_score:
            best_score = score
            best_node = node

    if best_node is None:
        best_node = root

    cloned = BeautifulSoup(str(best_node), "html.parser")
    _strip_noise(cloned)
    text_content = cloned.get_text(" ", strip=True)
    image_urls = _extract_images(cloned, base_url)
    return Candidate(
        content_html=str(cloned),
        text_content=text_content,
        image_urls=image_urls,
    )


def _score_node(node: Tag) -> float:
    paragraphs = node.find_all("p")
    paragraph_text = " ".join(p.get_text(" ", strip=True) for p in paragraphs)
    paragraph_len = len(paragraph_text)
    if paragraph_len < 140:
        return 0.0

    link_text_len = sum(len(a.get_text(" ", strip=True)) for a in node.find_all("a"))
    link_density = link_text_len / max(paragraph_len, 1)
    heading_bonus = sum(
        len(h.get_text(" ", strip=True)) for h in node.find_all(["h1", "h2", "h3"])
    ) * 0.25
    paragraph_count_bonus = len(paragraphs) * 20

    return paragraph_len * (1 - min(link_density, 0.85)) + heading_bonus + paragraph_count_bonus


def _extract_images(soup: BeautifulSoup, base_url: str) -> List[str]:
    urls: List[str] = []
    for img in soup.find_all("img"):
        raw = (
            img.get("src")
            or img.get("data-src")
            or img.get("data-original")
            or img.get("data-lazy-src")
            or ""
        )
        normalized = _normalize_image_url(str(raw), base_url)
        if normalized:
            urls.append(normalized)
    return _dedupe_list(urls)


def _extract_embedded_urls(soup: BeautifulSoup, base_url: str) -> List[str]:
    urls: List[str] = []

    for iframe in soup.find_all("iframe"):
        src = str(iframe.get("src") or "").strip()
        normalized = _normalize_embed_url(src, base_url)
        if normalized:
            urls.append(normalized)

    for link in soup.find_all("a"):
        href = str(link.get("href") or "").strip()
        normalized = _normalize_embed_url(href, base_url)
        if normalized:
            urls.append(normalized)

    return _dedupe_list(urls)


def _normalize_image_url(url: str, base_url: str) -> str:
    raw = (url or "").strip()
    if not raw or raw.startswith("data:"):
        return ""
    return urljoin(base_url, raw)


def _normalize_embed_url(url: str, base_url: str) -> str:
    raw = (url or "").strip()
    if not raw or raw.startswith("javascript:") or raw.startswith("#"):
        return ""
    normalized = urljoin(base_url, raw)
    parsed = urlparse(normalized)
    host = parsed.netloc.lower()
    if not any(keyword in host for keyword in MEDIA_EMBED_HOST_KEYWORDS):
        return ""

    if "youtube.com" in host and parsed.path.startswith("/embed/"):
        video_id = parsed.path.split("/embed/", 1)[1].split("/", 1)[0]
        if video_id:
            return f"https://www.youtube.com/watch?v={video_id}"
    return normalized


def _normalize_space(text: str) -> str:
    compact = re.sub(r"\s+", " ", text or "").strip()
    return compact


def _build_excerpt(text: str, max_len: int = 180) -> str:
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def _normalize_domain(url: str) -> str:
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    return domain[4:] if domain.startswith("www.") else domain


def _strip_site_suffix(title: str) -> str:
    """移除常見的網站後綴：' | Site'、' - Site'、' — Site'。"""
    cleaned = re.sub(r"\s*[\|—–\-]\s*[^|—–\-]{2,60}\s*$", "", title).strip()
    return cleaned if cleaned else title


def _dedupe_list(values: List[str]) -> List[str]:
    seen = set()
    output: List[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        output.append(value)
    return output


def _pick_best_candidate(primary: Optional[Candidate], fallback: Candidate) -> Candidate:
    if primary is None:
        return fallback

    primary_len = len(primary.text_content)
    fallback_len = len(fallback.text_content)

    if primary_len >= max(320, int(fallback_len * 0.75)):
        return primary
    return fallback

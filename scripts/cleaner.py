from __future__ import annotations

from datetime import datetime, timedelta, timezone
import html
import math
import re
from typing import List
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from .models import CleanedContent, ExtractionResult

try:
    from markdownify import markdownify as html_to_md  # type: ignore
except Exception:
    html_to_md = None


STRIP_TAGS = ("script", "style", "noscript", "iframe")
ALLOWED_ATTRS = {
    "a": {"href", "title"},
    "img": {"src", "alt", "title"},
}


def clean_to_markdown(extraction: ExtractionResult, read_time_wpm: int = 260) -> CleanedContent:
    soup = BeautifulSoup(extraction.content_html, "html.parser")
    embedded_urls = extraction.embedded_urls[:]
    _clean_soup(soup, extraction.url)

    markdown = _to_markdown(soup)
    markdown = _normalize_markdown(markdown)
    markdown = _sanitize_markdown(markdown, extraction.title)
    markdown = _strip_legacy_embed_section(markdown)
    markdown = _append_embedded_media(markdown, embedded_urls)
    excerpt = extraction.excerpt or _excerpt_from_markdown(markdown)

    image_urls = _extract_images(soup, extraction.url)
    word_count = _estimate_word_count(markdown)
    read_time_min = max(1, math.ceil(word_count / max(read_time_wpm, 120)))

    return CleanedContent(
        markdown=markdown,
        excerpt=excerpt,
        embedded_urls=embedded_urls,
        image_urls=image_urls,
        word_count=word_count,
        read_time_min=read_time_min,
    )


def _clean_soup(soup: BeautifulSoup, base_url: str) -> None:
    for tag_name in STRIP_TAGS:
        for node in soup.find_all(tag_name):
            node.decompose()

    for node in soup.find_all(True):
        _prune_attributes(node, base_url)


def _prune_attributes(node: Tag, base_url: str) -> None:
    tag_name = node.name.lower() if node.name else ""
    allowed = ALLOWED_ATTRS.get(tag_name, set())
    attrs = list(node.attrs.keys())
    for key in attrs:
        if key not in allowed:
            del node.attrs[key]

    if tag_name == "a" and node.get("href"):
        node["href"] = urljoin(base_url, node["href"])
    if tag_name == "img":
        src = node.get("src", "")
        node["src"] = urljoin(base_url, src) if src else ""


def _to_markdown(soup: BeautifulSoup) -> str:
    html = str(soup)
    if html_to_md is not None:
        return html_to_md(
            html,
            heading_style="ATX",
            bullets="-",
            strip=["span"],
        )
    return _fallback_markdown(soup)


def _fallback_markdown(soup: BeautifulSoup) -> str:
    blocks: List[str] = []
    for node in soup.find_all(["h1", "h2", "h3", "p", "blockquote", "li", "img"]):
        text = node.get_text(" ", strip=True)
        if node.name == "h1" and text:
            blocks.append(f"# {text}")
        elif node.name == "h2" and text:
            blocks.append(f"## {text}")
        elif node.name == "h3" and text:
            blocks.append(f"### {text}")
        elif node.name == "blockquote" and text:
            blocks.append(f"> {text}")
        elif node.name == "li" and text:
            blocks.append(f"- {text}")
        elif node.name == "img":
            src = node.get("src", "").strip()
            alt = node.get("alt", "").strip()
            if src:
                blocks.append(f"![{alt}]({src})")
        elif text:
            blocks.append(text)
    return "\n\n".join(blocks)


def _normalize_markdown(markdown: str) -> str:
    cleaned = markdown.replace("\r\n", "\n")
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    return cleaned.strip()


def _sanitize_markdown(markdown: str, title: str) -> str:
    if not markdown:
        return ""
    trimmed = _trim_comments_section(markdown)
    blocks = [part.strip() for part in re.split(r"\n\s*\n", trimmed) if part.strip()]
    if not blocks:
        return ""
    title_normalized = _normalize_for_compare(title)
    cleaned_blocks: List[str] = []
    seen_long_blocks: set[str] = set()
    for index, block in enumerate(blocks):
        normalized_block = _normalize_relative_day_block(block)
        if not normalized_block:
            continue
        if _is_title_block(normalized_block, title_normalized):
            continue
        compare_key = _normalize_for_compare(normalized_block)
        if not compare_key:
            continue
        if cleaned_blocks and compare_key == _normalize_for_compare(cleaned_blocks[-1]):
            continue
        if len(compare_key) >= 160:
            if compare_key in seen_long_blocks:
                continue
            seen_long_blocks.add(compare_key)
        cleaned_blocks.append(normalized_block)
    return "\n\n".join(cleaned_blocks).strip()


def _trim_comments_section(markdown: str) -> str:
    match = re.search(r"(?im)^#{1,6}\s*(comments?|留言|回應)\s*$", markdown)
    if not match:
        return markdown
    return markdown[: match.start()].rstrip()


def _normalize_for_compare(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = re.sub(r"^#+\s*", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.casefold().strip()


def _is_title_block(block: str, normalized_title: str) -> bool:
    if not normalized_title:
        return False
    block_key = _normalize_for_compare(block)
    if not block_key:
        return False
    return (
        block_key == normalized_title
        or normalized_title.startswith(block_key)
        or block_key.startswith(normalized_title)
    )


def _normalize_relative_day_block(block: str) -> str:
    raw = str(block or "").strip()
    if not raw:
        return ""
    token = re.sub(r"[。．.!,，]+$", "", raw).strip().casefold()
    today = datetime.now(timezone.utc).date()
    if re.match(r"^yesterday(\s+at\s+.+)?$", token):
        return (today - timedelta(days=1)).isoformat()
    if re.match(r"^today(\s+at\s+.+)?$", token):
        return today.isoformat()
    if token.startswith("昨天"):
        return (today - timedelta(days=1)).isoformat()
    if token.startswith("今天"):
        return today.isoformat()
    return raw


def _estimate_word_count(markdown: str) -> int:
    latin_words = len(re.findall(r"[A-Za-z0-9_]+", markdown))
    cjk_chars = len(re.findall(r"[\u4e00-\u9fff]", markdown))
    return max(1, latin_words + max(1, cjk_chars // 2))


def _excerpt_from_markdown(markdown: str, max_len: int = 180) -> str:
    plain = re.sub(r"!\[[^\]]*]\([^)]+\)", "", markdown)
    plain = re.sub(r"\[[^\]]+]\([^)]+\)", "", plain)
    plain = re.sub(r"[#>*`-]", " ", plain)
    plain = re.sub(r"\s+", " ", plain).strip()
    if len(plain) <= max_len:
        return plain
    return plain[: max_len - 1].rstrip() + "…"


def _extract_images(soup: BeautifulSoup, base_url: str) -> List[str]:
    seen = set()
    images: List[str] = []
    for img in soup.find_all("img"):
        src = img.get("src", "").strip()
        if not src:
            continue
        normalized = urljoin(base_url, src)
        if normalized.startswith("data:") or normalized in seen:
            continue
        seen.add(normalized)
        images.append(normalized)
    return images


def _append_embedded_media(markdown: str, embedded_urls: List[str]) -> str:
    urls = _dedupe_urls([html.unescape(str(url).strip()) for url in embedded_urls if str(url).strip()])
    if not urls:
        return markdown
    lines: List[str] = ["### Media Links"]
    lines.extend(f"[{url}]({url})" for url in urls)
    block = "\n\n".join(lines).strip()
    if not block:
        return markdown
    if not markdown:
        return block
    return f"{markdown}\n\n{block}"


def _strip_legacy_embed_section(markdown: str) -> str:
    if not markdown:
        return ""
    lines = markdown.splitlines()
    output: List[str] = []
    skipping = False

    for raw_line in lines:
        line = raw_line.strip()
        if re.match(r"^#{1,6}\s*embedded media\s*$", line, flags=re.IGNORECASE):
            skipping = True
            continue
        if skipping:
            if not line:
                continue
            if _looks_like_url(line):
                continue
            if re.match(r"^\[[^\]]*embed\]\([^)]+\)$", line, flags=re.IGNORECASE):
                continue
            if re.match(r"^[A-Za-z0-9 ._-]*embed$", line, flags=re.IGNORECASE):
                continue
            skipping = False
        output.append(raw_line)

    return "\n".join(output).strip()


def _looks_like_url(value: str) -> bool:
    return bool(re.match(r"^https?://\S+$", str(value or "").strip(), flags=re.IGNORECASE))


def _dedupe_urls(values: List[str]) -> List[str]:
    seen = set()
    output: List[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        output.append(value)
    return output

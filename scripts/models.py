from __future__ import annotations

from dataclasses import dataclass, field
from typing import List


@dataclass
class ExtractionResult:
    url: str
    title: str
    source_domain: str
    content_html: str
    text_content: str
    excerpt: str
    original_url: str = ""
    author: str = ""
    author_raw: str = ""
    media: str = ""
    media_raw: str = ""
    channel: str = ""
    channel_raw: str = ""
    media_logo_url: str = ""
    published_at: str = ""
    modified_at: str = ""
    content_type: str = ""
    language: str = ""
    cover_image_url: str = ""
    embedded_urls: List[str] = field(default_factory=list)
    image_urls: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


@dataclass
class CleanedContent:
    markdown: str
    excerpt: str
    embedded_urls: List[str]
    image_urls: List[str]
    word_count: int
    read_time_min: int

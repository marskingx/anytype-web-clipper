from types import SimpleNamespace
from unittest.mock import MagicMock

from scripts.anytype_clipper.service import (
    ClipperApp,
    PropertyManager,
    RelationResolver,
    _resolve_clip_title,
)


def _make_property_manager(property_defs: dict) -> PropertyManager:
    """Create a PropertyManager with a mock client and stubbed property defs."""
    mock_client = MagicMock()
    mock_relation_resolver = MagicMock(spec=RelationResolver)
    pm = PropertyManager(
        anytype_client=mock_client,
        relation_resolver=mock_relation_resolver,
    )
    pm._get_space_property_defs = lambda _space_id: dict(property_defs)
    return pm


def test_build_properties_bookmark_is_minimal() -> None:
    pm = _make_property_manager({
        "source": {"format": "url"},
        "tag": {"format": "multi_select"},
    })

    extraction = SimpleNamespace(
        url="https://example.com/post",
        excerpt="摘要內容",
    )
    properties, warnings = pm._build_properties(
        space_id="space-1",
        extraction=extraction,
        selected_type_key="bookmark",
        read_time_min=3,
        tags_text="",
        tag_options=["tag-key"],
        custom_fields={},
    )

    keys = [item.get("key") for item in properties]
    assert warnings == []
    assert keys == ["source", "tag"]


def test_build_properties_excludes_removed_metadata_fields() -> None:
    pm = _make_property_manager({
        "source_url": {"format": "url"},
        "source_domain": {"format": "text"},
        "excerpt": {"format": "text"},
        "read_time_min": {"format": "number"},
        "captured_at": {"format": "date"},
        "original_url": {"format": "url"},
        "author_raw": {"format": "text"},
        "media_raw": {"format": "text"},
        "channel_raw": {"format": "text"},
        "media_logo_url": {"format": "url"},
        "author": {"format": "text"},
        "media": {"format": "text"},
        "channel": {"format": "text"},
        "cover_image_url": {"format": "url"},
        "content_type": {"format": "text"},
        "language": {"format": "text"},
        "embedded_media_urls": {"format": "text"},
        "tags": {"format": "text"},
        "published_at": {"format": "date"},
        "modified_at": {"format": "date"},
    })

    extraction = SimpleNamespace(
        url="https://example.com/post",
        source_domain="example.com",
        excerpt="摘要內容",
        original_url="https://example.com/post",
        author="Author A",
        media="Media A",
        channel="Channel A",
        cover_image_url="https://example.com/cover.png",
        content_type="article",
        language="zh-tw",
        embedded_urls=["https://www.youtube.com/watch?v=test"],
        published_at="2026-02-23T01:02:03Z",
        modified_at="2026-02-23T04:05:06Z",
    )
    properties, warnings = pm._build_properties(
        space_id="space-1",
        extraction=extraction,
        selected_type_key="web_clip",
        read_time_min=3,
        tags_text="tag-a",
        tag_options=[],
        custom_fields={},
    )

    keys = [item.get("key") for item in properties]
    # 內部 raw 欄位永遠不應寫入
    assert "author_raw" not in keys
    assert "media_raw" not in keys
    assert "channel_raw" not in keys
    assert "media_logo_url" not in keys
    # 已移除的屬性不應出現
    assert "original_url" not in keys
    assert "source_domain" not in keys
    assert "channel" not in keys
    assert "content_type" not in keys
    assert "language" not in keys
    assert "tags" not in keys
    assert "modified_at" not in keys
    assert warnings == []


def test_resolve_clip_title_prefers_preferred_title() -> None:
    assert (
        _resolve_clip_title(
            preferred_title="頁面標題",
            extracted_title="其他標題",
            normalized_url="https://example.com/post",
        )
        == "頁面標題"
    )


def test_resolve_clip_title_skips_placeholder() -> None:
    assert (
        _resolve_clip_title(
            preferred_title="",
            extracted_title="Untitled Clip",
            normalized_url="https://example.com/post",
        )
        == "https://example.com/post"
    )


def test_check_auth_open_when_no_token() -> None:
    app = ClipperApp.__new__(ClipperApp)
    app._auth_token = ""
    assert app.check_auth("") is True
    assert app.check_auth("Bearer wrong") is True


def test_check_auth_validates_bearer_token() -> None:
    app = ClipperApp.__new__(ClipperApp)
    app._auth_token = "mytoken123"
    assert app.check_auth("Bearer mytoken123") is True
    assert app.check_auth("Bearer wrong") is False
    assert app.check_auth("") is False
    assert app.check_auth("Basic mytoken123") is False

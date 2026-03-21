from scripts.anytype_clipper.cleaner import clean_to_markdown
from scripts.anytype_clipper.models import ExtractionResult


def test_clean_to_markdown_generates_readable_output() -> None:
    extraction = ExtractionResult(
        url="https://example.com/a",
        title="標題",
        source_domain="example.com",
        content_html="""
        <article>
          <h1>標題</h1>
          <p>這是第一段內容。</p>
          <p>這是第二段內容。</p>
          <img src="/img/pic.jpg" alt="圖說" />
        </article>
        """,
        text_content="這是第一段內容。這是第二段內容。",
        excerpt="",
    )

    cleaned = clean_to_markdown(extraction, read_time_wpm=200)
    assert "# 標題" not in cleaned.markdown
    assert "第一段內容" in cleaned.markdown
    assert "https://example.com/img/pic.jpg" in cleaned.image_urls
    assert cleaned.read_time_min >= 1


def test_clean_to_markdown_embeds_in_body() -> None:
    """媒體連結同時出現在 body markdown（可點擊）與 embedded_urls 屬性中。"""
    extraction = ExtractionResult(
        url="https://example.com/a",
        title="標題",
        source_domain="example.com",
        content_html="<article><p>內文</p></article>",
        text_content="內文",
        excerpt="",
        embedded_urls=["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    )
    cleaned = clean_to_markdown(extraction, read_time_wpm=200)
    assert "### Media Links" in cleaned.markdown
    assert "https://www.youtube.com/watch?v=dQw4w9WgXcQ" in cleaned.markdown
    assert "https://www.youtube.com/watch?v=dQw4w9WgXcQ" in cleaned.embedded_urls


def test_clean_to_markdown_removes_legacy_embed_lines() -> None:
    extraction = ExtractionResult(
        url="https://example.com/a",
        title="標題",
        source_domain="example.com",
        content_html="""
        <article>
          <h4>Embedded Media</h4>
          <p>https://www.youtube.com/watch?v=We7BZVKbCVw&amp;t=2s</p>
          <p>YouTube Embed</p>
          <p>正文段落</p>
        </article>
        """,
        text_content="正文段落",
        excerpt="",
        embedded_urls=["https://www.youtube.com/watch?v=We7BZVKbCVw&amp;t=2s"],
    )
    cleaned = clean_to_markdown(extraction, read_time_wpm=200)
    assert "Embedded Media" not in cleaned.markdown
    assert "YouTube Embed" not in cleaned.markdown
    # URL 出現在 body（### Media Links section）與 embedded_urls 屬性中
    assert any("We7BZVKbCVw" in u for u in cleaned.embedded_urls)
    assert any("We7BZVKbCVw" in line for line in cleaned.markdown.splitlines())


def test_clean_to_markdown_normalizes_relative_date_and_trims_comments() -> None:
    extraction = ExtractionResult(
        url="https://example.com/a",
        title="重複標題",
        source_domain="example.com",
        content_html="""
        <article>
          <h1>重複標題</h1>
          <p>Yesterday</p>
          <p>正文第一段。</p>
          <h2>Comments</h2>
          <p>這裡應該被移除。</p>
        </article>
        """,
        text_content="",
        excerpt="",
    )
    cleaned = clean_to_markdown(extraction, read_time_wpm=200)
    assert "重複標題" not in cleaned.markdown
    assert "Yesterday" not in cleaned.markdown
    assert "正文第一段。" in cleaned.markdown
    assert "Comments" not in cleaned.markdown
    assert "這裡應該被移除。" not in cleaned.markdown


def test_clean_to_markdown_deduplicates_title_with_site_suffix() -> None:
    """瀏覽器 tab.title 含 ' | Patreon' 後綴時，body 中的 h1 仍應被去重。"""
    extraction = ExtractionResult(
        url="https://www.patreon.com/posts/test-article",
        title="Claude Code 趣事 | Patreon",
        source_domain="patreon.com",
        content_html="""
        <article>
          <h1>Claude Code 趣事</h1>
          <p>第一段正文。</p>
          <h1>Claude Code 趣事</h1>
          <p>第二段正文。</p>
        </article>
        """,
        text_content="第一段正文。第二段正文。",
        excerpt="",
    )
    cleaned = clean_to_markdown(extraction, read_time_wpm=200)
    # 兩個 h1 都應被去重，正文保留
    assert "Claude Code 趣事" not in cleaned.markdown
    assert "第一段正文。" in cleaned.markdown
    assert "第二段正文。" in cleaned.markdown

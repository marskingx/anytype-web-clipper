from scripts.anytype_clipper.extractor import extract_article, _strip_site_suffix


SAMPLE_HTML = """
<html>
  <head>
    <title>新聞標題</title>
    <meta name="author" content="Mars" />
    <meta property="article:published_time" content="2026-02-22T12:00:00Z" />
    <meta property="og:image" content="https://cdn.example.com/cover.jpg" />
  </head>
  <body>
    <header>Header nav</header>
    <article>
      <h1>新聞標題</h1>
      <p>這是一段很重要的文章內容，應該要被保留下來。</p>
      <p>第二段內容提供更多細節，模擬實際文章。</p>
      <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
      <img src="/images/a.jpg" />
    </article>
    <aside>廣告內容</aside>
  </body>
</html>
"""


def test_extract_article_basic_fields() -> None:
    result = extract_article("https://example.com/post-1", SAMPLE_HTML)
    assert result.title == "新聞標題"
    assert result.author == "Mars"
    assert "文章內容" in result.text_content
    assert result.source_domain == "example.com"
    assert result.image_urls[0] == "https://cdn.example.com/cover.jpg"
    assert "https://example.com/images/a.jpg" in result.image_urls
    assert "https://www.youtube.com/watch?v=dQw4w9WgXcQ" in result.embedded_urls


def test_strip_site_suffix_removes_site_name() -> None:
    assert _strip_site_suffix("Claude Code 趣事 | Patreon") == "Claude Code 趣事"
    assert _strip_site_suffix("文章標題 - Medium") == "文章標題"
    assert _strip_site_suffix("Article Title — The New York Times") == "Article Title"
    assert _strip_site_suffix("純標題") == "純標題"
    assert _strip_site_suffix("") == ""


def test_extract_article_strips_site_suffix_from_title() -> None:
    html = """
    <html>
      <head>
        <title>測試文章 | Patreon</title>
      </head>
      <body>
        <article><p>這是一段足夠長的文章內文，讓抽取器能正確處理。</p></article>
      </body>
    </html>
    """
    result = extract_article("https://www.patreon.com/posts/test", html)
    assert result.title == "測試文章"
    assert "Patreon" not in result.title


def test_extract_article_prefers_canonical_and_jsonld() -> None:
    html = """
    <html lang="zh-TW">
      <head>
        <title>Fallback Title</title>
        <link rel="canonical" href="https://media.example.com/articles/canonical-post" />
        <meta property="og:type" content="article" />
        <meta property="og:description" content="OG Desc" />
        <meta property="article:modified_time" content="2026-01-20T03:00:00Z" />
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "NewsArticle",
          "headline": "JSONLD Headline",
          "description": "JSONLD Desc",
          "author": {"@type":"Person", "name":"Boris Cherny"},
          "publisher": {
            "@type":"Organization",
            "name":"IEObserve",
            "logo": {"@type":"ImageObject", "url":"https://cdn.example.com/logo.png"}
          },
          "datePublished":"2026-01-17T08:00:00Z",
          "dateModified":"2026-01-20T03:30:00Z",
          "image":"https://cdn.example.com/cover-jsonld.jpg",
          "articleSection":"AI"
        }
        </script>
      </head>
      <body>
        <article><p>內文內容足夠長，讓抽取器可以保留正文資訊。</p></article>
      </body>
    </html>
    """
    result = extract_article("https://example.com/raw-url", html)
    assert result.url == "https://media.example.com/articles/canonical-post"
    assert result.original_url == "https://example.com/raw-url"
    assert result.title == "JSONLD Headline"
    assert result.excerpt == "JSONLD Desc"
    assert result.author_raw == "Boris Cherny"
    assert result.media_raw == "IEObserve"
    assert result.channel_raw == "AI"
    assert result.published_at == "2026-01-17T08:00:00Z"
    assert result.modified_at == "2026-01-20T03:30:00Z"
    assert result.content_type == "article"
    assert result.language == "zh-tw"
    assert result.cover_image_url == "https://cdn.example.com/cover-jsonld.jpg"
    assert result.media_logo_url == "https://cdn.example.com/logo.png"

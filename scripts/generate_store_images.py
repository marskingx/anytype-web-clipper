"""
Generate Chrome Web Store promotional images for Anytype Clipper extension.

Output:
  scripts/anytype_clipper/store_assets/
    screenshot_1_clipper_ui.png      (1280x800)
    screenshot_2_auth_flow.png       (1280x800)
    screenshot_3_tag_feature.png     (1280x800)
    screenshot_4_preview_save.png    (1280x800)
    screenshot_5_duplicate.png       (1280x800)
    small_promo_tile.png             (440x280)
    marquee_promo_tile.png           (1400x560)
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# --- Color Palette (matches extension dark theme) ---
BG_DARK = (15, 23, 42)        # #0f172a
BG_DEEPER = (2, 6, 23)        # #020617
BG_CARD = (11, 18, 32)        # #0b1220
BORDER = (51, 65, 85)         # #334155
BORDER_DARK = (30, 41, 59)    # #1e293b
TEXT_PRIMARY = (226, 232, 240) # #e2e8f0
TEXT_SECONDARY = (148, 163, 184) # #94a3b8
TEXT_MUTED = (100, 116, 139)   # #64748b
GREEN = (34, 197, 94)         # #22c55e
CYAN = (6, 182, 212)          # #06b6d4
BLUE_LINK = (147, 197, 253)   # #93c5fd
RED_ERROR = (252, 165, 165)   # #fca5a5
WHITE = (248, 250, 252)       # #f8fafc
TAG_COLORS = {
    'green': (34, 197, 94),
    'blue': (59, 130, 246),
    'purple': (168, 85, 247),
    'orange': (249, 115, 22),
    'pink': (236, 72, 153),
    'yellow': (234, 179, 8),
}
BROWSER_BG = (30, 30, 30)
BROWSER_TAB_BG = (50, 50, 50)
BROWSER_TOOLBAR = (38, 38, 38)
WEBPAGE_BG = (255, 255, 255)
WEBPAGE_TEXT = (30, 30, 30)
WEBPAGE_TEXT_LIGHT = (120, 120, 120)

OUTPUT_DIR = Path(__file__).parent / "store_assets"

# --- Fonts ---
FONT_BOLD = "segoeuib.ttf"
FONT_REGULAR = "segoeui.ttf"
FONT_LIGHT = "segoeuil.ttf"
FONT_CJK = "msjhbd.ttc"
FONT_CJK_REGULAR = "msjh.ttc"


def font(name, size):
    return ImageFont.truetype(name, size)


def draw_rounded_rect(draw, xy, radius, fill=None, outline=None, width=1):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def draw_gradient_button(img, xy, text, font_obj, radius=10):
    draw = ImageDraw.Draw(img)
    x0, y0, x1, y1 = xy
    for i in range(int(y1 - y0)):
        ratio = i / (y1 - y0)
        r = int(GREEN[0] * (1 - ratio) + CYAN[0] * ratio)
        g = int(GREEN[1] * (1 - ratio) + CYAN[1] * ratio)
        b = int(GREEN[2] * (1 - ratio) + CYAN[2] * ratio)
        draw.line([(x0, y0 + i), (x1, y0 + i)], fill=(r, g, b))
    mask = Image.new("L", img.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    draw_rounded_rect(mask_draw, xy, radius, fill=255)
    bg = Image.new("RGBA", img.size, (0, 0, 0, 0))
    img_rgba = img.convert("RGBA")
    result = Image.composite(img_rgba, bg, mask)
    img.paste(result.convert("RGB"), (0, 0))
    draw = ImageDraw.Draw(img)
    draw_rounded_rect(draw, xy, radius, fill=None)
    bbox = font_obj.getbbox(text)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = x0 + (x1 - x0 - tw) // 2
    ty = y0 + (y1 - y0 - th) // 2 - 2
    draw.text((tx, ty), text, fill=BG_DARK, font=font_obj)


def draw_gradient_rect(draw, xy, radius=10):
    x0, y0, x1, y1 = xy
    draw_rounded_rect(draw, xy, radius, fill=GREEN)


def draw_tag_chip(draw, x, y, text, color, font_obj):
    bbox = font_obj.getbbox(text)
    tw = bbox[2] - bbox[0]
    chip_w = tw + 20
    chip_h = 24
    bg_color = (color[0] // 5, color[1] // 5, color[2] // 5)
    draw_rounded_rect(draw, (x, y, x + chip_w, y + chip_h), 12, fill=bg_color, outline=color, width=1)
    draw.text((x + 10, y + 4), text, fill=color, font=font_obj)
    return chip_w + 6


# --- Browser chrome mockup ---
def draw_browser_chrome(img, draw, url="https://example.com/article"):
    w = img.width
    # Title bar
    draw.rectangle([(0, 0), (w, 30)], fill=BROWSER_TAB_BG)
    # Tab
    draw_rounded_rect(draw, (8, 4, 200, 30), 6, fill=BROWSER_BG)
    draw.text((20, 8), "Example Article", fill=(200, 200, 200), font=font(FONT_REGULAR, 13))
    # Close / min / max dots
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        draw.ellipse((w - 70 + i * 20, 10, w - 58 + i * 20, 22), fill=c)
    # Toolbar
    draw.rectangle([(0, 30), (w, 68)], fill=BROWSER_TOOLBAR)
    # URL bar
    draw_rounded_rect(draw, (80, 36, w - 80, 62), 8, fill=(60, 60, 60))
    draw.text((96, 42), url, fill=(180, 180, 180), font=font(FONT_REGULAR, 13))
    # Nav arrows
    draw.text((16, 40), "←  →", fill=(150, 150, 150), font=font(FONT_REGULAR, 14))
    return 68


def draw_webpage_content(draw, x, y, w, h, title="AI 如何改變個人理財規劃", lang="zh"):
    draw.rectangle([(x, y), (x + w, y + h)], fill=WEBPAGE_BG)
    # Header bar mockup
    draw.rectangle([(x, y), (x + w, y + 50)], fill=(245, 245, 245))
    draw.text((x + 20, y + 14), "懶得變有錢", fill=(50, 50, 50), font=font(FONT_CJK, 18))
    # Navigation
    nav_items = ["首頁", "部落格", "Podcast", "工具"]
    nx = x + 200
    for item in nav_items:
        draw.text((nx, y + 16), item, fill=(100, 100, 100), font=font(FONT_CJK_REGULAR, 14))
        nx += 80
    # Article content
    cy = y + 70
    draw.text((x + 40, cy), title, fill=WEBPAGE_TEXT, font=font(FONT_CJK, 26))
    cy += 50
    draw.text((x + 40, cy), "Mars Lee  ·  2026-02-28  ·  財務規劃與心態", fill=WEBPAGE_TEXT_LIGHT, font=font(FONT_CJK_REGULAR, 13))
    cy += 40
    # Fake article lines
    for i in range(12):
        line_w = w - 100 if i % 4 != 3 else w - 200
        draw.rectangle([(x + 40, cy), (x + 40 + line_w, cy + 10)], fill=(230, 230, 230))
        cy += 22
    return cy


# --- Extension popup mockup ---
def draw_popup_panel(img, draw, px, py, panel_w=340):
    """Draw the main clipper popup panel and return bottom y."""
    # Panel background
    panel_h = 520
    draw_rounded_rect(draw, (px, py, px + panel_w, py + panel_h), 12, fill=BG_DARK, outline=BORDER, width=1)
    # Drop shadow
    cy = py + 14

    # Title
    draw.text((px + 14, cy), "Lazy to Anytype Clipper", fill=TEXT_PRIMARY, font=font(FONT_BOLD, 15))
    cy += 32

    # Title field
    draw.text((px + 14, cy), "Title", fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 11))
    cy += 18
    draw_rounded_rect(draw, (px + 14, cy, px + panel_w - 14, cy + 34), 8, fill=BG_DEEPER, outline=BORDER, width=1)
    draw.text((px + 22, cy + 8), "AI 如何改變個人理財規劃", fill=WHITE, font=font(FONT_CJK_REGULAR, 13))
    cy += 44

    # Space field
    draw.text((px + 14, cy), "Space", fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 11))
    cy += 18
    draw_rounded_rect(draw, (px + 14, cy, px + panel_w - 14, cy + 34), 8, fill=BG_DEEPER, outline=BORDER, width=1)
    draw.text((px + 22, cy + 8), "懶得變有錢", fill=WHITE, font=font(FONT_CJK_REGULAR, 13))
    # Dropdown arrow
    draw.text((px + panel_w - 36, cy + 8), "▾", fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 14))
    cy += 44

    # Save As
    draw.text((px + 14, cy), "Save As", fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 11))
    cy += 18
    draw_rounded_rect(draw, (px + 14, cy, px + panel_w - 14, cy + 34), 8, fill=BG_DEEPER, outline=BORDER, width=1)
    draw.text((px + 22, cy + 8), "📄 Bookmark", fill=WHITE, font=font(FONT_REGULAR, 13))
    draw.text((px + panel_w - 36, cy + 8), "▾", fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 14))
    cy += 44

    # Tag field
    draw.text((px + 14, cy), "Tag", fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 11))
    cy += 18
    draw_rounded_rect(draw, (px + 14, cy, px + panel_w - 14, cy + 36), 8, fill=BG_DEEPER, outline=BORDER, width=1)
    # Tag chips
    tx = px + 20
    for tag_name, tag_color in [("理財", TAG_COLORS['green']), ("AI", TAG_COLORS['blue']), ("科技", TAG_COLORS['purple'])]:
        chip_w = draw_tag_chip(draw, tx, cy + 6, tag_name, tag_color, font(FONT_CJK_REGULAR, 11))
        tx += chip_w
    cy += 48

    # Preview card
    draw_rounded_rect(draw, (px + 14, cy, px + panel_w - 14, cy + 90), 10, fill=BG_CARD, outline=BORDER, width=1)
    draw.text((px + 22, cy + 8), "儲存預覽", fill=TEXT_PRIMARY, font=font(FONT_CJK, 11))
    # Preview items
    items = [("來源", "marskingx.co"), ("頁面文字", "2,847 字"), ("媒體連結", "3")]
    iw = (panel_w - 44) // 3
    for i, (label, val) in enumerate(items):
        ix = px + 22 + i * iw
        iy = cy + 30
        draw_rounded_rect(draw, (ix, iy, ix + iw - 6, iy + 48), 6, fill=BG_DEEPER, outline=BORDER_DARK, width=1)
        draw.text((ix + 6, iy + 6), label, fill=TEXT_SECONDARY, font=font(FONT_CJK_REGULAR, 10))
        draw.text((ix + 6, iy + 24), val, fill=TEXT_PRIMARY, font=font(FONT_REGULAR, 11))
    cy += 100

    # Save button
    draw_gradient_rect(draw, (px + 14, cy, px + panel_w - 14, cy + 38), 10)
    bbox = font(FONT_BOLD, 14).getbbox("Save")
    tw = bbox[2] - bbox[0]
    draw.text((px + (panel_w - tw) // 2, cy + 10), "Save", fill=BG_DARK, font=font(FONT_BOLD, 14))
    cy += 48

    # Status
    draw.text((px + 14, cy), "準備就緒", fill=TEXT_SECONDARY, font=font(FONT_CJK_REGULAR, 11))

    return py + panel_h


def draw_auth_panel(img, draw, px, py, panel_w=340, step="code"):
    panel_h = 300
    draw_rounded_rect(draw, (px, py, px + panel_w, py + panel_h), 12, fill=BG_DARK, outline=BORDER, width=1)
    cy = py + 24

    # Icon placeholder
    icon_x = px + panel_w // 2 - 24
    draw_rounded_rect(draw, (icon_x, cy, icon_x + 48, cy + 48), 8, fill=GREEN)
    draw.text((icon_x + 12, cy + 10), "A", fill=BG_DARK, font=font(FONT_BOLD, 24))
    cy += 60

    draw.text((px + 60, cy), "Lazy to Anytype Clipper", fill=TEXT_PRIMARY, font=font(FONT_BOLD, 15))
    cy += 36

    if step == "code":
        draw.text((px + 110, cy), "輸入驗證碼", fill=WHITE, font=font(FONT_CJK, 14))
        cy += 24
        draw.text((px + 52, cy), "請查看 Anytype 桌面版顯示的 4 碼驗證碼", fill=TEXT_SECONDARY, font=font(FONT_CJK_REGULAR, 11))
        cy += 30
        # Code input
        code_w = 160
        code_x = px + (panel_w - code_w) // 2
        draw_rounded_rect(draw, (code_x, cy, code_x + code_w, cy + 50), 12, fill=BG_DEEPER, outline=GREEN, width=2)
        draw.text((code_x + 28, cy + 8), "1 2 3 4", fill=WHITE, font=font(FONT_BOLD, 26))
        cy += 62
        # Button
        btn_w = 180
        btn_x = px + (panel_w - btn_w) // 2
        draw_gradient_rect(draw, (btn_x, cy, btn_x + btn_w, cy + 36), 10)
        draw.text((btn_x + 50, cy + 8), "確認驗證", fill=BG_DARK, font=font(FONT_CJK, 13))

    elif step == "success":
        # Success icon
        cx = px + panel_w // 2 - 24
        cy += 10
        draw.ellipse((cx, cy, cx + 48, cy + 48), fill=(34, 197, 94, 50), outline=GREEN, width=2)
        draw.text((cx + 14, cy + 10), "✓", fill=GREEN, font=font(FONT_BOLD, 22))
        cy += 64
        draw.text((px + 120, cy), "驗證成功", fill=WHITE, font=font(FONT_CJK, 15))

    return py + panel_h


def make_screenshot_base(url="https://marskingx.co/blog/ai-financial-planning/"):
    """Create base screenshot with browser chrome and webpage."""
    img = Image.new("RGB", (1280, 800), BROWSER_BG)
    draw = ImageDraw.Draw(img)
    chrome_h = draw_browser_chrome(img, draw, url=url)
    draw_webpage_content(draw, 0, chrome_h, 1280, 800 - chrome_h)
    return img, draw


# ==================== Screenshot 1: Main Clipper UI ====================
def generate_screenshot_1():
    img, draw = make_screenshot_base()
    px = 1280 - 340 - 20
    py = 68 + 10
    draw_popup_panel(img, draw, px, py)
    return img


# ==================== Screenshot 2: Auth/Verification ====================
def generate_screenshot_2():
    img, draw = make_screenshot_base("https://anytype.io")
    draw_webpage_content(draw, 0, 68, 1280, 732, title="Welcome to Anytype", lang="en")
    px = 1280 - 340 - 20
    py = 68 + 40
    draw_auth_panel(img, draw, px, py, step="code")
    return img


# ==================== Screenshot 3: Tag Feature ====================
def generate_screenshot_3():
    img, draw = make_screenshot_base()
    px = 1280 - 340 - 20
    py = 68 + 10
    panel_w = 340

    # Base panel
    panel_h = 520
    draw_rounded_rect(draw, (px, py, px + panel_w, py + panel_h), 12, fill=BG_DARK, outline=BORDER, width=1)
    cy = py + 14
    draw.text((px + 14, cy), "Lazy to Anytype Clipper", fill=TEXT_PRIMARY, font=font(FONT_BOLD, 15))
    cy += 32

    # Title
    draw.text((px + 14, cy), "Title", fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 11))
    cy += 18
    draw_rounded_rect(draw, (px + 14, cy, px + panel_w - 14, cy + 34), 8, fill=BG_DEEPER, outline=BORDER, width=1)
    draw.text((px + 22, cy + 8), "ETF 投資入門指南", fill=WHITE, font=font(FONT_CJK_REGULAR, 13))
    cy += 44

    # Space
    draw.text((px + 14, cy), "Space", fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 11))
    cy += 18
    draw_rounded_rect(draw, (px + 14, cy, px + panel_w - 14, cy + 34), 8, fill=BG_DEEPER, outline=BORDER, width=1)
    draw.text((px + 22, cy + 8), "懶得變有錢", fill=WHITE, font=font(FONT_CJK_REGULAR, 13))
    draw.text((px + panel_w - 36, cy + 8), "▾", fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 14))
    cy += 44

    # Save As
    draw.text((px + 14, cy), "Save As", fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 11))
    cy += 18
    draw_rounded_rect(draw, (px + 14, cy, px + panel_w - 14, cy + 34), 8, fill=BG_DEEPER, outline=BORDER, width=1)
    draw.text((px + 22, cy + 8), "📄 Bookmark", fill=WHITE, font=font(FONT_REGULAR, 13))
    draw.text((px + panel_w - 36, cy + 8), "▾", fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 14))
    cy += 44

    # Tag — with dropdown open
    draw.text((px + 14, cy), "Tag", fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 11))
    cy += 18
    draw_rounded_rect(draw, (px + 14, cy, px + panel_w - 14, cy + 36), 8, fill=BG_DEEPER, outline=GREEN, width=2)
    # Existing chips
    tx = px + 20
    chip_w = draw_tag_chip(draw, tx, cy + 6, "ETF", TAG_COLORS['blue'], font(FONT_CJK_REGULAR, 11))
    tx += chip_w
    chip_w = draw_tag_chip(draw, tx, cy + 6, "投資", TAG_COLORS['green'], font(FONT_CJK_REGULAR, 11))
    tx += chip_w
    # Cursor text
    draw.text((tx + 4, cy + 10), "理財|", fill=TEXT_SECONDARY, font=font(FONT_CJK_REGULAR, 12))
    cy += 42

    # Tag dropdown
    dropdown_tags = [
        ("理財規劃", TAG_COLORS['green']),
        ("理財工具", TAG_COLORS['orange']),
        ("理財心得", TAG_COLORS['purple']),
        ("+ 建立「理財」", CYAN),
    ]
    draw_rounded_rect(draw, (px + 14, cy, px + panel_w - 14, cy + len(dropdown_tags) * 32 + 8), 8, fill=BG_DEEPER, outline=BORDER, width=1)
    dy = cy + 4
    for i, (tag_text, tag_color) in enumerate(dropdown_tags):
        if i == 0:
            draw.rectangle([(px + 16, dy), (px + panel_w - 16, dy + 28)], fill=(30, 41, 59))
        draw.ellipse((px + 24, dy + 8, px + 36, dy + 20), fill=tag_color)
        draw.text((px + 44, dy + 6), tag_text, fill=TEXT_PRIMARY if i < 3 else CYAN, font=font(FONT_CJK_REGULAR, 12))
        dy += 32

    return img


# ==================== Screenshot 4: Preview & Save Success ====================
def generate_screenshot_4():
    img, draw = make_screenshot_base()
    px = 1280 - 340 - 20
    py = 68 + 10
    panel_w = 340

    panel_h = 480
    draw_rounded_rect(draw, (px, py, px + panel_w, py + panel_h), 12, fill=BG_DARK, outline=BORDER, width=1)
    cy = py + 14
    draw.text((px + 14, cy), "Lazy to Anytype Clipper", fill=TEXT_PRIMARY, font=font(FONT_BOLD, 15))
    cy += 32

    # Compact fields
    for label_text, value in [("Title", "AI 如何改變個人理財規劃"), ("Space", "懶得變有錢"), ("Save As", "📄 Bookmark")]:
        draw.text((px + 14, cy), label_text, fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 11))
        cy += 18
        draw_rounded_rect(draw, (px + 14, cy, px + panel_w - 14, cy + 30), 8, fill=BG_DEEPER, outline=BORDER, width=1)
        draw.text((px + 22, cy + 6), value, fill=WHITE, font=font(FONT_CJK_REGULAR, 12))
        cy += 38

    # Tags
    draw.text((px + 14, cy), "Tag", fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 11))
    cy += 18
    draw_rounded_rect(draw, (px + 14, cy, px + panel_w - 14, cy + 30), 8, fill=BG_DEEPER, outline=BORDER, width=1)
    tx = px + 20
    for tag_name, tag_color in [("理財", TAG_COLORS['green']), ("AI", TAG_COLORS['blue'])]:
        chip_w = draw_tag_chip(draw, tx, cy + 4, tag_name, tag_color, font(FONT_CJK_REGULAR, 10))
        tx += chip_w
    cy += 38

    # Preview card
    draw_rounded_rect(draw, (px + 14, cy, px + panel_w - 14, cy + 110), 10, fill=BG_CARD, outline=BORDER, width=1)
    draw.text((px + 22, cy + 8), "儲存預覽", fill=TEXT_PRIMARY, font=font(FONT_CJK, 11))
    items = [("來源", "marskingx.co"), ("頁面文字", "2,847 字"), ("媒體連結", "3")]
    iw = (panel_w - 44) // 3
    for i, (label, val) in enumerate(items):
        ix = px + 22 + i * iw
        iy = cy + 28
        draw_rounded_rect(draw, (ix, iy, ix + iw - 6, iy + 40), 6, fill=BG_DEEPER, outline=BORDER_DARK, width=1)
        draw.text((ix + 6, iy + 4), label, fill=TEXT_SECONDARY, font=font(FONT_CJK_REGULAR, 10))
        draw.text((ix + 6, iy + 20), val, fill=TEXT_PRIMARY, font=font(FONT_REGULAR, 11))
    # Media embed preview
    embed_y = cy + 74
    draw_rounded_rect(draw, (px + 22, embed_y, px + panel_w - 22, embed_y + 26), 6, fill=(59, 130, 246, 30), outline=(29, 78, 216))
    draw.text((px + 30, embed_y + 5), "🎬 youtube.com/watch?v=abc123", fill=BLUE_LINK, font=font(FONT_REGULAR, 11))
    cy += 120

    # Result card - success
    draw_rounded_rect(draw, (px + 14, cy, px + panel_w - 14, cy + 80), 10, fill=BG_CARD, outline=GREEN, width=1)
    draw.text((px + 22, cy + 10), "✅ 已儲存到 Anytype！", fill=GREEN, font=font(FONT_CJK, 13))
    # Buttons row
    btn_y = cy + 40
    draw_rounded_rect(draw, (px + 22, btn_y, px + 160, btn_y + 30), 8, fill=BG_DEEPER, outline=BORDER, width=1)
    draw.text((px + 34, btn_y + 6), "Open in Anytype", fill=TEXT_PRIMARY, font=font(FONT_REGULAR, 11))
    draw_rounded_rect(draw, (px + 168, btn_y, px + panel_w - 22, btn_y + 30), 8, fill=BG_DEEPER, outline=BORDER, width=1)
    draw.text((px + 180, btn_y + 6), "Copy Object ID", fill=TEXT_PRIMARY, font=font(FONT_REGULAR, 11))

    return img


# ==================== Screenshot 5: Duplicate Detection ====================
def generate_screenshot_5():
    img, draw = make_screenshot_base()
    # Dim the background
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 120))
    img = img.convert("RGBA")
    img = Image.alpha_composite(img, overlay)
    img = img.convert("RGB")
    draw = ImageDraw.Draw(img)

    # Modal
    modal_w = 380
    modal_h = 220
    mx = (1280 - modal_w) // 2
    my = (800 - modal_h) // 2
    draw_rounded_rect(draw, (mx, my, mx + modal_w, my + modal_h), 14, fill=BG_DARK, outline=BORDER, width=1)

    cy = my + 20
    draw.text((mx + 20, cy), "偵測到重複網址", fill=WHITE, font=font(FONT_CJK, 16))
    cy += 32
    draw.text((mx + 20, cy), "同網址已有內容，請選擇要更新或另存。", fill=TEXT_SECONDARY, font=font(FONT_CJK_REGULAR, 12))
    cy += 32

    # Existing object preview
    draw_rounded_rect(draw, (mx + 20, cy, mx + modal_w - 20, cy + 44), 8, fill=BG_DEEPER, outline=BORDER_DARK, width=1)
    draw.text((mx + 30, cy + 6), "📄 AI 如何改變個人理財規劃", fill=TEXT_PRIMARY, font=font(FONT_CJK_REGULAR, 13))
    draw.text((mx + 30, cy + 26), "Space: 懶得變有錢  ·  2026-02-20", fill=TEXT_MUTED, font=font(FONT_CJK_REGULAR, 10))
    cy += 58

    # Buttons
    btn_w = 105
    gap = 10
    bx = mx + 20
    # Update button
    draw_gradient_rect(draw, (bx, cy, bx + btn_w, cy + 34), 8)
    draw.text((bx + 16, cy + 8), "更新既有", fill=BG_DARK, font=font(FONT_CJK, 12))
    bx += btn_w + gap
    # Create new
    draw_rounded_rect(draw, (bx, cy, bx + btn_w, cy + 34), 8, fill=BG_DEEPER, outline=BORDER, width=1)
    draw.text((bx + 10, cy + 8), "另存新物件", fill=TEXT_PRIMARY, font=font(FONT_CJK, 12))
    bx += btn_w + gap
    # Cancel
    draw_rounded_rect(draw, (bx, cy, bx + btn_w, cy + 34), 8, fill=BG_DEEPER, outline=BORDER, width=1)
    draw.text((bx + 30, cy + 8), "取消", fill=TEXT_PRIMARY, font=font(FONT_CJK, 12))

    return img


# ==================== Small Promo Tile (440x280) ====================
def generate_small_promo():
    img = Image.new("RGB", (440, 280), BG_DARK)
    draw = ImageDraw.Draw(img)

    # Background gradient effect
    for y in range(280):
        ratio = y / 280
        r = int(BG_DARK[0] * (1 - ratio * 0.3))
        g = int(BG_DARK[1] * (1 - ratio * 0.3))
        b = int(BG_DARK[2] * (1 - ratio * 0.1))
        draw.line([(0, y), (440, y)], fill=(r, g, b))

    # Decorative circles
    draw.ellipse((-40, -40, 120, 120), fill=(34, 197, 94, 20), outline=None)
    draw.ellipse((360, 180, 500, 320), fill=(6, 182, 212, 20), outline=None)

    # Top accent line
    for x in range(440):
        ratio = x / 440
        r = int(GREEN[0] * (1 - ratio) + CYAN[0] * ratio)
        g = int(GREEN[1] * (1 - ratio) + CYAN[1] * ratio)
        b = int(GREEN[2] * (1 - ratio) + CYAN[2] * ratio)
        draw.point((x, 0), fill=(r, g, b))
        draw.point((x, 1), fill=(r, g, b))
        draw.point((x, 2), fill=(r, g, b))

    # Icon
    icon_size = 56
    icon_x = (440 - icon_size) // 2
    icon_y = 40
    draw_rounded_rect(draw, (icon_x, icon_y, icon_x + icon_size, icon_y + icon_size), 14, fill=GREEN)
    draw.text((icon_x + 14, icon_y + 10), "A", fill=BG_DARK, font=font(FONT_BOLD, 32))

    # Title
    title = "Lazy to Anytype Clipper"
    bbox = font(FONT_BOLD, 20).getbbox(title)
    tw = bbox[2] - bbox[0]
    draw.text(((440 - tw) // 2, 112), title, fill=WHITE, font=font(FONT_BOLD, 20))

    # Tagline
    tagline = "網頁剪輯，直送 Anytype"
    bbox = font(FONT_CJK, 14).getbbox(tagline)
    tw = bbox[2] - bbox[0]
    draw.text(((440 - tw) // 2, 145), tagline, fill=TEXT_SECONDARY, font=font(FONT_CJK, 14))

    # Feature pills
    features = ["🔒 本機直連", "📄 全文保存", "🏷️ 智慧標籤"]
    pill_font = font(FONT_CJK_REGULAR, 11)
    total_w = 0
    pill_data = []
    for feat in features:
        bbox = pill_font.getbbox(feat)
        pw = bbox[2] - bbox[0] + 20
        pill_data.append((feat, pw))
        total_w += pw + 8
    total_w -= 8

    fx = (440 - total_w) // 2
    fy = 182
    for feat_text, pw in pill_data:
        draw_rounded_rect(draw, (fx, fy, fx + pw, fy + 26), 13, fill=BG_DEEPER, outline=BORDER, width=1)
        draw.text((fx + 10, fy + 5), feat_text, fill=TEXT_PRIMARY, font=pill_font)
        fx += pw + 8

    # Bottom tagline
    bottom = "Chrome Extension · 免費 · 開源"
    bbox = font(FONT_CJK_REGULAR, 11).getbbox(bottom)
    tw = bbox[2] - bbox[0]
    draw.text(((440 - tw) // 2, 240), bottom, fill=TEXT_MUTED, font=font(FONT_CJK_REGULAR, 11))

    return img


# ==================== Marquee Promo Tile (1400x560) ====================
def generate_marquee_promo():
    img = Image.new("RGB", (1400, 560), BG_DARK)
    draw = ImageDraw.Draw(img)

    # Background gradient
    for y in range(560):
        ratio = y / 560
        r = int(BG_DARK[0] + (BG_DEEPER[0] - BG_DARK[0]) * ratio)
        g = int(BG_DARK[1] + (BG_DEEPER[1] - BG_DARK[1]) * ratio)
        b = int(BG_DARK[2] + (BG_DEEPER[2] - BG_DARK[2]) * ratio)
        draw.line([(0, y), (1400, y)], fill=(r, g, b))

    # Decorative gradient circles
    for cx, cy_c, rad, color in [
        (200, 100, 200, GREEN),
        (1200, 400, 250, CYAN),
        (700, 500, 180, (59, 130, 246)),
    ]:
        for r in range(rad, 0, -1):
            alpha = max(0, int(15 * (r / rad)))
            c = (color[0] // (15 - alpha + 1), color[1] // (15 - alpha + 1), color[2] // (15 - alpha + 1))
            draw.ellipse((cx - r, cy_c - r, cx + r, cy_c + r), outline=c)

    # Top gradient bar
    for x in range(1400):
        ratio = x / 1400
        r = int(GREEN[0] * (1 - ratio) + CYAN[0] * ratio)
        g = int(GREEN[1] * (1 - ratio) + CYAN[1] * ratio)
        b = int(GREEN[2] * (1 - ratio) + CYAN[2] * ratio)
        for dy in range(4):
            draw.point((x, dy), fill=(r, g, b))

    # Left side: Text content
    # Icon
    icon_x, icon_y = 100, 120
    icon_size = 72
    draw_rounded_rect(draw, (icon_x, icon_y, icon_x + icon_size, icon_y + icon_size), 18, fill=GREEN)
    draw.text((icon_x + 18, icon_y + 12), "A", fill=BG_DARK, font=font(FONT_BOLD, 42))

    # Extension name
    draw.text((100, 215), "Lazy to Anytype", fill=WHITE, font=font(FONT_BOLD, 42))
    draw.text((100, 270), "Clipper", fill=WHITE, font=font(FONT_BOLD, 42))

    # Tagline
    draw.text((100, 335), "網頁剪輯，直送 Anytype", fill=TEXT_SECONDARY, font=font(FONT_CJK, 22))

    # Description
    draw.text((100, 380), "一鍵儲存網頁到本機 Anytype — 全文、標籤、媒體，一次搞定", fill=TEXT_MUTED, font=font(FONT_CJK_REGULAR, 15))

    # Feature badges
    features = [
        ("🔒", "本機直連", "無需雲端"),
        ("📄", "全文保存", "Markdown 格式"),
        ("🏷️", "智慧標籤", "自動分類"),
        ("🖼️", "媒體備份", "圖片自動緩存"),
    ]
    fx = 100
    fy = 430
    for emoji, title_text, desc_text in features:
        draw_rounded_rect(draw, (fx, fy, fx + 130, fy + 70), 10, fill=BG_CARD, outline=BORDER, width=1)
        draw.text((fx + 10, fy + 8), emoji, fill=WHITE, font=font(FONT_REGULAR, 16))
        draw.text((fx + 36, fy + 10), title_text, fill=TEXT_PRIMARY, font=font(FONT_CJK, 13))
        draw.text((fx + 36, fy + 34), desc_text, fill=TEXT_MUTED, font=font(FONT_CJK_REGULAR, 11))
        fx += 145

    # Right side: Mini popup mockup
    rpx = 820
    rpy = 80
    rpw = 480
    rph = 420

    # Browser frame
    draw_rounded_rect(draw, (rpx, rpy, rpx + rpw, rpy + rph), 12, fill=BROWSER_BG, outline=BORDER, width=1)
    # Tab bar
    draw.rectangle([(rpx + 1, rpy + 1), (rpx + rpw - 1, rpy + 28)], fill=BROWSER_TAB_BG)
    draw_rounded_rect(draw, (rpx + 8, rpy + 4, rpx + 160, rpy + 28), 5, fill=BROWSER_BG)
    draw.text((rpx + 16, rpy + 7), "marskingx.co", fill=(180, 180, 180), font=font(FONT_REGULAR, 12))
    # Window dots
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        draw.ellipse((rpx + rpw - 60 + i * 16, rpy + 9, rpx + rpw - 50 + i * 16, rpy + 19), fill=c)

    # Webpage area
    wp_y = rpy + 30
    draw.rectangle([(rpx + 1, wp_y), (rpx + rpw - 1, rpy + rph - 1)], fill=WEBPAGE_BG)
    # Fake content lines
    ly = wp_y + 20
    draw.text((rpx + 20, ly), "懶得變有錢", fill=(50, 50, 50), font=font(FONT_CJK, 14))
    ly += 30
    draw.text((rpx + 20, ly), "AI 如何改變個人理財規劃", fill=WEBPAGE_TEXT, font=font(FONT_CJK, 18))
    ly += 36
    for i in range(6):
        lw = rpw - 60 if i % 3 != 2 else rpw - 120
        draw.rectangle([(rpx + 20, ly), (rpx + 20 + lw, ly + 8)], fill=(230, 230, 230))
        ly += 18

    # Mini popup overlay on the right of the browser
    mpx = rpx + rpw - 260
    mpy = wp_y + 10
    mpw = 240
    mph = 340
    draw_rounded_rect(draw, (mpx, mpy, mpx + mpw, mpy + mph), 10, fill=BG_DARK, outline=BORDER, width=1)
    mcy = mpy + 10
    draw.text((mpx + 10, mcy), "Lazy to Anytype Clipper", fill=TEXT_PRIMARY, font=font(FONT_BOLD, 11))
    mcy += 22
    # Mini fields
    for lbl, val in [("Title", "AI 如何改變個人理財規劃"), ("Space", "懶得變有錢"), ("Save As", "📄 Bookmark")]:
        draw.text((mpx + 10, mcy), lbl, fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 9))
        mcy += 13
        draw_rounded_rect(draw, (mpx + 10, mcy, mpx + mpw - 10, mcy + 22), 5, fill=BG_DEEPER, outline=BORDER, width=1)
        draw.text((mpx + 16, mcy + 4), val, fill=WHITE, font=font(FONT_CJK_REGULAR, 9))
        mcy += 28
    # Tags
    draw.text((mpx + 10, mcy), "Tag", fill=TEXT_SECONDARY, font=font(FONT_REGULAR, 9))
    mcy += 13
    draw_rounded_rect(draw, (mpx + 10, mcy, mpx + mpw - 10, mcy + 22), 5, fill=BG_DEEPER, outline=BORDER, width=1)
    tx = mpx + 14
    for tag_name, tag_color in [("理財", TAG_COLORS['green']), ("AI", TAG_COLORS['blue'])]:
        chip_w = draw_tag_chip(draw, tx, mcy + 3, tag_name, tag_color, font(FONT_CJK_REGULAR, 8))
        tx += chip_w
    mcy += 28
    # Mini preview
    draw_rounded_rect(draw, (mpx + 10, mcy, mpx + mpw - 10, mcy + 50), 6, fill=BG_CARD, outline=BORDER, width=1)
    draw.text((mpx + 16, mcy + 4), "儲存預覽", fill=TEXT_PRIMARY, font=font(FONT_CJK, 9))
    mini_items = [("來源", "marskingx.co"), ("文字", "2,847"), ("媒體", "3")]
    miw = (mpw - 30) // 3
    for i, (ml, mv) in enumerate(mini_items):
        mix = mpx + 16 + i * miw
        miy = mcy + 20
        draw_rounded_rect(draw, (mix, miy, mix + miw - 4, miy + 24), 4, fill=BG_DEEPER, outline=BORDER_DARK, width=1)
        draw.text((mix + 4, miy + 2), ml, fill=TEXT_SECONDARY, font=font(FONT_CJK_REGULAR, 7))
        draw.text((mix + 4, miy + 13), mv, fill=TEXT_PRIMARY, font=font(FONT_REGULAR, 8))
    mcy += 58
    # Save button
    draw_gradient_rect(draw, (mpx + 10, mcy, mpx + mpw - 10, mcy + 24), 6)
    draw.text((mpx + 95, mcy + 4), "Save", fill=BG_DARK, font=font(FONT_BOLD, 11))

    return img


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    generators = [
        ("screenshot_1_clipper_ui.png", generate_screenshot_1),
        ("screenshot_2_auth_flow.png", generate_screenshot_2),
        ("screenshot_3_tag_feature.png", generate_screenshot_3),
        ("screenshot_4_preview_save.png", generate_screenshot_4),
        ("screenshot_5_duplicate.png", generate_screenshot_5),
        ("small_promo_tile.png", generate_small_promo),
        ("marquee_promo_tile.png", generate_marquee_promo),
    ]

    for filename, gen_func in generators:
        path = OUTPUT_DIR / filename
        img = gen_func()
        # Convert to RGB to ensure 24-bit PNG (no alpha)
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.save(str(path), "PNG")
        print(f"✅ {filename} ({img.width}x{img.height})")

    print(f"\n📁 All images saved to: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()

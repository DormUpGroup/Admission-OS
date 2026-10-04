from pathlib import Path

from PIL import Image

SRC = Path(
    r"C:\Users\Asus\.cursor\projects\c-MY-LIFE-Work-ITALY-IMMIGROME-OS\assets"
    r"\c__Users_Asus_AppData_Roaming_Cursor_User_workspaceStorage_"
    r"d9e147aa9072e441046a3fc01ae551d8_images_image-87ac6b43-2b7f-4cca-8b50-439db7d62ae8.jpg"
)
ROOT = Path(__file__).resolve().parents[1]
PUBLIC_BRAND = ROOT / "public" / "brand"
APP_DIR = ROOT / "src" / "app"


def near_white(r: int, g: int, b: int, threshold: int = 248) -> bool:
    return r >= threshold and g >= threshold and b >= threshold


def content_bbox(img: Image.Image, threshold: int = 248):
    pixels = img.load()
    w, h = img.size
    minx, miny, maxx, maxy = w, h, 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            r, g, b, *_ = pixels[x, y]
            if not near_white(r, g, b, threshold):
                found = True
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)
    if not found:
        return (0, 0, w, h)
    return (minx, miny, maxx + 1, maxy + 1)


def make_transparent(img: Image.Image, threshold: int = 248) -> Image.Image:
    rgba = img.convert("RGBA")
    pixels = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if near_white(r, g, b, threshold):
                pixels[x, y] = (255, 255, 255, 0)
            else:
                # Soften near-white fringe
                brightness = (r + g + b) / 3
                if brightness > 230:
                    alpha = int(max(0, min(255, (255 - brightness) * 8)))
                    pixels[x, y] = (r, g, b, alpha)
    return rgba


def pad_to_square(img: Image.Image, padding_ratio: float = 0.12) -> Image.Image:
    w, h = img.size
    side = max(w, h)
    pad = int(side * padding_ratio)
    canvas_side = side + pad * 2
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    canvas.paste(img, ((canvas_side - w) // 2, (canvas_side - h) // 2), img)
    return canvas


def main() -> None:
    PUBLIC_BRAND.mkdir(parents=True, exist_ok=True)
    APP_DIR.mkdir(parents=True, exist_ok=True)

    raw = Image.open(SRC).convert("RGBA")
    bbox = content_bbox(raw)
    print("raw size", raw.size, "bbox", bbox)
    cropped = raw.crop(bbox)
    logo = make_transparent(cropped)

    # Full wordmark for UI headers
    logo_path = PUBLIC_BRAND / "aos-logo.png"
    logo.save(logo_path, optimize=True)
    print("wrote", logo_path, logo.size)

    # Wider padded wordmark for login hero
    pad_x = int(logo.width * 0.04)
    pad_y = int(logo.height * 0.08)
    padded = Image.new(
        "RGBA",
        (logo.width + pad_x * 2, logo.height + pad_y * 2),
        (0, 0, 0, 0),
    )
    padded.paste(logo, (pad_x, pad_y), logo)
    padded_path = PUBLIC_BRAND / "aos-logo-padded.png"
    padded.save(padded_path, optimize=True)

    # Favicon: only the stylized letter A (left third of the wordmark)
    w, h = logo.size
    mark = logo.crop((0, 0, int(w * 0.335), h))
    mark_bbox = content_bbox(mark, threshold=250)
    mark = mark.crop(mark_bbox)
    favicon_src = pad_to_square(mark, padding_ratio=0.14)

    for size, name in ((180, "apple-icon.png"), (192, "icon.png")):
        out = favicon_src.resize((size, size), Image.Resampling.LANCZOS)
        path = APP_DIR / name
        out.save(path, optimize=True)
        print("wrote", path, out.size)

    ico_sizes = [(16, 16), (32, 32), (48, 48)]
    ico_images = [
        favicon_src.resize(size, Image.Resampling.LANCZOS) for size in ico_sizes
    ]
    for ico_path in (APP_DIR / "favicon.ico", ROOT / "public" / "favicon.ico"):
        ico_images[-1].save(
            ico_path,
            format="ICO",
            sizes=ico_sizes,
            append_images=ico_images[:-1],
        )
        print("wrote", ico_path)

    # Also keep a public favicon copy for static fallbacks
    public_icon = PUBLIC_BRAND / "aos-mark.png"
    favicon_src.resize((256, 256), Image.Resampling.LANCZOS).save(
        public_icon, optimize=True
    )
    print("wrote", public_icon)


if __name__ == "__main__":
    main()

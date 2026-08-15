from __future__ import annotations

import json
import re
from collections import OrderedDict
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "Архив курса"
OUTPUT = ROOT / "assets" / "course-data.js"
RELEASE_MAP = ROOT / ".work" / "site-release-assets.tsv"
RELEASE_TAG = "course-videos-720p"
RELEASE_BASE = f"https://github.com/davidataka/course_albina/releases/download/{RELEASE_TAG}"


def natural_key(value: str) -> list[object]:
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value)]


def clean_folder_name(value: str) -> str:
    value = re.sub(r"^\d+_", "", value)
    return value.replace("_", " ").strip()


def display_duration(seconds: int) -> str:
    hours, remainder = divmod(seconds, 3600)
    minutes = remainder // 60
    return f"{hours} ч {minutes:02d} мин"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def main() -> None:
    order_files = sorted(
        (path for path in ARCHIVE.rglob("порядок.json") if "_служебное" not in path.parts),
        key=lambda path: natural_key(path.relative_to(ARCHIVE).as_posix()),
    )
    if len(order_files) != 49:
        raise RuntimeError(f"Ожидалось 49 уроков, найдено {len(order_files)}")

    sections: OrderedDict[str, dict] = OrderedDict()
    release_rows: list[str] = []
    image_count = 0
    video_count = 0
    duration_seconds = 0

    for lesson_index, order_path in enumerate(order_files, start=1):
        lesson_dir = order_path.parent
        order = load_json(order_path)
        metadata_path = lesson_dir / "метаданные.json"
        metadata = load_json(metadata_path) if metadata_path.exists() else {}
        relative_dir = lesson_dir.relative_to(ARCHIVE)
        folder_parts = list(relative_dir.parts)
        section_key = folder_parts[0]
        section_title = clean_folder_name(section_key)
        section = sections.setdefault(section_key, {"id": f"section-{len(sections) + 1:02d}", "title": section_title, "lessons": []})
        blocks: list[dict] = []

        for token in order.get("orderedTokens", []):
            token_type = token.get("type")
            if token_type == "image":
                image_file = lesson_dir / "Изображения" / token["file"]
                if not image_file.exists():
                    raise FileNotFoundError(f"Не найдено изображение: {image_file}")
                image_count += 1
                blocks.append(
                    {
                        "type": "image",
                        "number": int(token.get("number", 1)),
                        "src": image_file.relative_to(ROOT).as_posix(),
                        "alt": f"{order['title']} — изображение {token.get('number', 1)}",
                    }
                )
            elif token_type == "video":
                number = int(token.get("number", 1))
                video_file = lesson_dir / f"Видео {number:02d}.mp4"
                if not video_file.exists():
                    raise FileNotFoundError(f"Не найдено видео: {video_file}")
                caption_file = lesson_dir / f"Видео {number:02d}.vtt"
                asset_name = f"lesson-{lesson_index:03d}-video-{number:02d}.mp4"
                video_count += 1
                blocks.append(
                    {
                        "type": "video",
                        "number": number,
                        "src": f"{RELEASE_BASE}/{quote(asset_name)}",
                        "localSrc": video_file.relative_to(ROOT).as_posix(),
                        "caption": caption_file.relative_to(ROOT).as_posix() if caption_file.exists() else None,
                        "assetName": asset_name,
                    }
                )
                release_rows.append(f"{asset_name}\t{video_file.resolve()}\t{order['title']} — видео {number:02d}")
            elif token_type == "text":
                text = str(token.get("text", "")).strip()
                if text:
                    blocks.append({"type": "text", "style": token.get("style") or "paragraph", "text": text})

        lesson_duration = sum(int(video.get("duration") or 0) for video in order.get("videos", []))
        duration_seconds += lesson_duration
        section["lessons"].append(
            {
                "id": f"lesson-{lesson_index:03d}",
                "index": lesson_index,
                "title": order.get("title") or metadata.get("title") or clean_folder_name(folder_parts[-1]),
                "description": order.get("description") or metadata.get("description") or "",
                "breadcrumb": [clean_folder_name(part) for part in folder_parts],
                "blocks": blocks,
            }
        )

    payload = {
        "title": "Коррекция питания и ЗОЖ",
        "stats": {
            "lessons": len(order_files),
            "videos": video_count,
            "images": image_count,
            "duration": display_duration(duration_seconds),
        },
        "sections": list(sections.values()),
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        "window.COURSE_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
        newline="\n",
    )
    RELEASE_MAP.parent.mkdir(parents=True, exist_ok=True)
    RELEASE_MAP.write_text("\n".join(release_rows) + "\n", encoding="utf-8", newline="\n")
    print(f"Собрано: {len(order_files)} уроков, {video_count} видео, {image_count} изображений")
    print(f"Данные сайта: {OUTPUT.relative_to(ROOT)}")
    print(f"Карта release assets: {RELEASE_MAP.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

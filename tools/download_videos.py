import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
FFMPEG = ROOT / ".tools" / "ffmpeg" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffmpeg.exe"
FFPROBE = FFMPEG.with_name("ffprobe.exe")
JOBS_FILE = ROOT / ".work" / "medium-video-jobs.json"
LOG_DIR = ROOT / "Архив курса" / "_служебное" / "журнал-видео"


def download(job: dict) -> dict:
    public_job = {key: value for key, value in job.items() if key not in {"playlist", "subtitle"}}
    output = ROOT / job["output"]
    output.parent.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"{job['job_id']:03d}.log"

    existing_validation = validate_video(output)
    expected_duration = job.get("expected_duration") or 0
    existing_duration = float(existing_validation.get("format", {}).get("duration", 0) or 0)
    if (
        output.exists()
        and output.stat().st_size > 1_000_000
        and existing_duration >= expected_duration * 0.98
        and any(stream.get("codec_type") == "video" for stream in existing_validation.get("streams", []))
        and any(stream.get("codec_type") == "audio" for stream in existing_validation.get("streams", []))
    ):
        result = {**public_job, "status": "skipped", "size": output.stat().st_size}
        download_subtitle(job)
        return result

    playlist = select_best_playlist(job["playlist"], job.get("target_height", 720))

    command = [
        str(FFMPEG),
        "-hide_banner",
        "-loglevel", "warning",
        "-y",
        "-f", "hls",
        "-allowed_extensions", "ALL",
        "-allowed_segment_extensions", "ALL",
        "-extension_picky", "0",
        "-i", playlist,
        "-c", "copy",
        str(output),
    ]
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.run(command, stdout=log, stderr=log, text=True)

    if process.returncode != 0 or not output.exists():
        log_text = log_path.read_text(encoding="utf-8", errors="replace")
        log_text = re.sub(r"https?://\S+", "[URL скрыт]", log_text)
        log_path.write_text(log_text, encoding="utf-8")
        return {**public_job, "status": "failed", "returncode": process.returncode}

    validation = validate_video(output)
    download_subtitle(job)
    log_path.unlink(missing_ok=True)
    return {**public_job, "status": "downloaded", "validation": validation}


def validate_video(output: Path) -> dict:
    if not output.exists():
        return {}
    probe = subprocess.run(
        [
            str(FFPROBE), "-v", "error", "-show_entries",
            "format=duration,size", "-show_entries",
            "stream=codec_type,codec_name,width,height", "-of", "json", str(output),
        ],
        capture_output=True,
        text=True,
    )
    try:
        return json.loads(probe.stdout)
    except json.JSONDecodeError:
        return {"probe_error": probe.stderr.strip()}


def select_best_playlist(master_url: str, target_height: int = 720) -> str:
    try:
        with urlopen(master_url, timeout=60) as response:
            text = response.read().decode("utf-8", errors="replace")
    except Exception:
        return master_url

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    candidates = []
    for index, line in enumerate(lines):
        if not line.startswith("#EXT-X-STREAM-INF"):
            continue
        resolution = re.search(r"RESOLUTION=(\d+)x(\d+)", line)
        bandwidth = re.search(r"BANDWIDTH=(\d+)", line)
        for following in lines[index + 1:]:
            if following.startswith("#"):
                continue
            width = int(resolution.group(1)) if resolution else 0
            height = int(resolution.group(2)) if resolution else 0
            rate = int(bandwidth.group(1)) if bandwidth else 0
            candidates.append((height, width, rate, urljoin(master_url, following)))
            break
    if not candidates:
        return master_url
    at_or_below_target = [item for item in candidates if item[0] <= target_height]
    if at_or_below_target:
        at_or_below_target.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
        return at_or_below_target[0][3]
    candidates.sort(key=lambda item: (item[0], item[1], item[2]))
    return candidates[0][3]


def download_subtitle(job: dict) -> None:
    subtitle_url = job.get("subtitle")
    subtitle_output = job.get("subtitle_output")
    if not subtitle_url or not subtitle_output:
        return
    destination = ROOT / subtitle_output
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size > 0:
        return
    try:
        with urlopen(subtitle_url, timeout=60) as response:
            destination.write_bytes(response.read())
    except Exception as error:
        destination.with_suffix(".ошибка.txt").write_text(str(error), encoding="utf-8")


def main() -> int:
    jobs = json.loads(JOBS_FILE.read_text(encoding="utf-8"))
    results = []
    print(f"Видео к сохранению: {len(jobs)}", flush=True)
    with ThreadPoolExecutor(max_workers=3) as executor:
        future_map = {executor.submit(download, job): job for job in jobs}
        for completed, future in enumerate(as_completed(future_map), start=1):
            result = future.result()
            results.append(result)
            print(
                f"[{completed}/{len(jobs)}] {result['status']}: {result['title']}",
                flush=True,
            )

    report = ROOT / "Архив курса" / "_служебное" / "отчет-видео.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    failed = [result for result in results if result["status"] == "failed"]
    print(f"Готово: {len(results) - len(failed)}; ошибок: {len(failed)}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

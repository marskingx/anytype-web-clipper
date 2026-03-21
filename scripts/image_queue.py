from __future__ import annotations

import hashlib
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests


BackupCallback = Callable[[str, str, str, str], None]


@dataclass
class DownloadResult:
    url: str
    local_path: str = ""
    status: str = "failed"
    error: str = ""


class ImageBackupQueue:
    def __init__(
        self,
        *,
        cache_dir: Path,
        max_workers: int = 2,
        timeout_sec: int = 20,
        retries: int = 1,
        on_complete: Optional[BackupCallback] = None,
    ) -> None:
        self.cache_dir = cache_dir
        self.images_dir = cache_dir / "images"
        self.manifests_dir = cache_dir / "manifests"
        self.images_dir.mkdir(parents=True, exist_ok=True)
        self.manifests_dir.mkdir(parents=True, exist_ok=True)
        self.timeout_sec = timeout_sec
        self.retries = retries
        self.on_complete = on_complete
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._lock = threading.Lock()
        self._status: Dict[str, Dict[str, int | str]] = {}

    def enqueue(self, *, space_id: str, object_id: str, image_urls: List[str]) -> None:
        urls = _dedupe(image_urls)
        if not urls:
            return
        with self._lock:
            self._status[object_id] = {
                "state": "pending",
                "total": len(urls),
                "success": 0,
                "failed": 0,
            }
        self._executor.submit(self._process, space_id, object_id, urls)

    def get_status(self, object_id: str) -> Dict[str, int | str]:
        with self._lock:
            if object_id not in self._status:
                return {"state": "not_found", "total": 0, "success": 0, "failed": 0}
            return dict(self._status[object_id])

    def _process(self, space_id: str, object_id: str, image_urls: List[str]) -> None:
        results: List[DownloadResult] = []
        success = 0
        failed = 0
        for url in image_urls:
            result = self._download_with_retry(url)
            results.append(result)
            if result.status == "done":
                success += 1
            else:
                failed += 1

        manifest_path = self.manifests_dir / f"{object_id}.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "object_id": object_id,
                    "space_id": space_id,
                    "total": len(image_urls),
                    "success": success,
                    "failed": failed,
                    "items": [result.__dict__ for result in results],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        final_state = "done" if failed == 0 else "failed"
        with self._lock:
            self._status[object_id] = {
                "state": final_state,
                "total": len(image_urls),
                "success": success,
                "failed": failed,
            }

        if self.on_complete is not None:
            try:
                self.on_complete(space_id, object_id, final_state, str(manifest_path))
            except Exception as exc:  # pragma: no cover - callback isolation
                print(f"[image_queue] callback failed: {exc}")

    def _download_with_retry(self, url: str) -> DownloadResult:
        last_error = ""
        for _ in range(self.retries + 1):
            ok, path_or_error = self._download_once(url)
            if ok:
                return DownloadResult(url=url, local_path=path_or_error, status="done")
            last_error = path_or_error
        return DownloadResult(url=url, status="failed", error=last_error)

    def _download_once(self, url: str) -> Tuple[bool, str]:
        try:
            response = requests.get(url, timeout=self.timeout_sec, stream=True)
            if response.status_code >= 400:
                return False, f"http_{response.status_code}"

            suffix = _guess_suffix(url, response.headers.get("Content-Type", ""))
            digest = hashlib.sha1(url.encode("utf-8")).hexdigest()
            target = self.images_dir / f"{digest}{suffix}"
            with target.open("wb") as fp:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        fp.write(chunk)
            return True, str(target)
        except Exception as exc:
            return False, str(exc)


def _guess_suffix(url: str, content_type: str) -> str:
    parsed = urlparse(url)
    candidate = Path(parsed.path).suffix.lower()
    if candidate in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"}:
        return candidate
    mapping = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/svg+xml": ".svg",
    }
    return mapping.get(content_type.split(";")[0].strip().lower(), ".img")


def _dedupe(values: List[str]) -> List[str]:
    seen = set()
    output: List[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        output.append(value)
    return output


#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import threading
import secrets
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse, urlunparse

import requests


def _ordered_dedup(items: List[str]) -> List[str]:
    """De-duplicate a list of strings while preserving insertion order."""
    seen: set[str] = set()
    result: List[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


# Support execution via file path: `python scripts/anytype_clipper/service.py`
if __package__ in (None, ""):
    _repo_root = Path(__file__).resolve().parents[2]
    if str(_repo_root) not in sys.path:
        sys.path.insert(0, str(_repo_root))

from scripts.anytype_clipper.anytype_client import (
    AnytypeClient,
    DEFAULT_API_VERSION,
    DEFAULT_BASE_URL,
)
from scripts.anytype_clipper.cleaner import clean_to_markdown
from scripts.anytype_clipper.config_loader import load_config
from scripts.anytype_clipper.extractor import extract_article
from scripts.anytype_clipper.image_queue import ImageBackupQueue


class RequestError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


DEFAULT_RELATION_TARGETS: Dict[str, List[str]] = {
    "author": ["human", "person"],
    "media": ["media", "publisher", "organization"],
    "channel": ["channel"],
}


# ---------------------------------------------------------------------------
# Helper class 1: PropertyManager
# ---------------------------------------------------------------------------

class PropertyManager:
    """Manages space property definitions, filtering, and building property payloads."""

    def __init__(
        self,
        anytype_client: AnytypeClient,
        relation_resolver: RelationResolver,
    ) -> None:
        self._client = anytype_client
        self._relation_resolver = relation_resolver
        self._space_property_keys: dict[str, set[str]] = {}
        self._space_property_defs: dict[str, dict[str, Dict[str, Any]]] = {}
        self._property_lock = threading.Lock()

    def _refresh_space_properties(self, space_id: str) -> set[str]:
        props = self._client.list_properties(space_id)
        keys = set(props.keys())
        with self._property_lock:
            self._space_property_keys[space_id] = keys
            self._space_property_defs[space_id] = props
        return keys

    def _get_space_properties(self, space_id: str) -> set[str]:
        with self._property_lock:
            if space_id in self._space_property_keys:
                return set(self._space_property_keys[space_id])
        return self._refresh_space_properties(space_id)

    def _get_space_property_defs(self, space_id: str) -> dict[str, Dict[str, Any]]:
        with self._property_lock:
            if space_id in self._space_property_defs:
                return dict(self._space_property_defs[space_id])
        self._refresh_space_properties(space_id)
        with self._property_lock:
            return dict(self._space_property_defs.get(space_id, {}))

    def _filter_supported_properties(
        self,
        space_id: str,
        properties: List[Dict[str, Any]],
    ) -> tuple[List[Dict[str, Any]], List[str]]:
        supported = self._get_space_properties(space_id)
        filtered: List[Dict[str, Any]] = []
        dropped: List[str] = []
        for item in properties:
            key = str(item.get("key", "")).strip()
            if not key:
                continue
            if key in supported:
                filtered.append(item)
            else:
                dropped.append(key)
        return filtered, _ordered_dedup(dropped)

    def _build_properties(
        self,
        *,
        space_id: str,
        extraction,
        selected_type_key: str,
        read_time_min: int,
        tags_text: str,
        tag_options: List[str],
        custom_fields: Dict[str, str],
    ) -> tuple[List[Dict[str, Any]], List[str]]:
        property_defs = self._get_space_property_defs(space_id)
        captured_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        properties: List[Dict[str, Any]] = []
        warnings: List[str] = []
        normalized_type_key = str(selected_type_key or "").strip().lower()

        if normalized_type_key == "bookmark":
            self._append_property(
                space_id=space_id,
                property_defs=property_defs,
                properties=properties,
                warnings=warnings,
                key="source",
                value=extraction.url,
                default_format="url",
            )
            if tag_options:
                properties.append({"key": "tag", "multi_select": tag_options})
            return properties, warnings

        self._append_property(
            space_id=space_id,
            property_defs=property_defs,
            properties=properties,
            warnings=warnings,
            key="source_url",
            value=extraction.url,
            default_format="url",
        )
        self._append_property(
            space_id=space_id,
            property_defs=property_defs,
            properties=properties,
            warnings=warnings,
            key="excerpt",
            value=extraction.excerpt,
            default_format="text",
        )
        self._append_property(
            space_id=space_id,
            property_defs=property_defs,
            properties=properties,
            warnings=warnings,
            key="read_time_min",
            value=read_time_min,
            default_format="number",
        )
        self._append_property(
            space_id=space_id,
            property_defs=property_defs,
            properties=properties,
            warnings=warnings,
            key="captured_at",
            value=captured_at,
            default_format="date",
        )

        author_value = custom_fields.get("author") or extraction.author
        media_value = custom_fields.get("media") or extraction.media

        # Legacy keys: still write when property is text; if objects and unresolved, skip silently.
        self._append_property(
            space_id=space_id,
            property_defs=property_defs,
            properties=properties,
            warnings=warnings,
            key="author",
            value=author_value,
            default_format="text",
            warn_on_unresolved_objects=False,
        )
        self._append_property(
            space_id=space_id,
            property_defs=property_defs,
            properties=properties,
            warnings=warnings,
            key="media",
            value=media_value,
            default_format="text",
            warn_on_unresolved_objects=False,
        )
        self._append_property(
            space_id=space_id,
            property_defs=property_defs,
            properties=properties,
            warnings=warnings,
            key="cover_image_url",
            value=extraction.cover_image_url,
            default_format="url",
        )
        if extraction.embedded_urls:
            embedded_json = json.dumps(extraction.embedded_urls, ensure_ascii=False)
            self._append_property(
                space_id=space_id,
                property_defs=property_defs,
                properties=properties,
                warnings=warnings,
                key="embedded_media_urls",
                value=embedded_json,
                default_format="text",
            )
        if tag_options:
            properties.append({"key": "tag", "multi_select": tag_options})

        published_iso = _normalize_iso_datetime(extraction.published_at)
        self._append_property(
            space_id=space_id,
            property_defs=property_defs,
            properties=properties,
            warnings=warnings,
            key="published_at",
            value=published_iso,
            default_format="date",
        )

        reserved = {
            "source_url",
            "excerpt",
            "read_time_min",
            "captured_at",
            "author_raw",
            "media_raw",
            "channel_raw",
            "author",
            "media",
            "media_logo_url",
            "cover_image_url",
            "embedded_media_urls",
            "tag",
            "published_at",
        }
        for key, value in custom_fields.items():
            if key in reserved:
                continue
            if not value:
                continue
            self._append_property(
                space_id=space_id,
                property_defs=property_defs,
                properties=properties,
                warnings=warnings,
                key=key,
                value=value,
                default_format="text",
            )

        return properties, warnings

    def _append_property(
        self,
        *,
        space_id: str,
        property_defs: dict[str, Dict[str, Any]],
        properties: List[Dict[str, Any]],
        warnings: List[str],
        key: str,
        value: Any,
        default_format: str,
        warn_on_unresolved_objects: bool = True,
    ) -> None:
        if value is None:
            return
        key = str(key or "").strip()
        if not key:
            return

        if isinstance(value, str):
            value = value.strip()
            if not value:
                return

        prop_def = property_defs.get(key) or {}
        format_name = str(prop_def.get("format") or default_format or "text").strip().lower()

        if format_name == "url":
            text_value = str(value).strip()
            if not text_value:
                return
            properties.append({"key": key, "url": text_value})
            return

        if format_name == "number":
            try:
                number_value = float(value)
            except Exception:
                warnings.append(f"property_number_invalid:{key}:{value}")
                return
            properties.append({"key": key, "number": number_value})
            return

        if format_name == "date":
            normalized = _normalize_iso_datetime(str(value))
            if not normalized:
                warnings.append(f"property_date_invalid:{key}:{value}")
                return
            properties.append({"key": key, "date": normalized})
            return

        if format_name == "checkbox":
            if isinstance(value, bool):
                properties.append({"key": key, "checkbox": value})
                return
            raw = str(value).strip().lower()
            mapping = {
                "1": True,
                "true": True,
                "yes": True,
                "y": True,
                "on": True,
                "0": False,
                "false": False,
                "no": False,
                "n": False,
                "off": False,
            }
            if raw not in mapping:
                warnings.append(f"property_checkbox_invalid:{key}:{value}")
                return
            properties.append({"key": key, "checkbox": mapping[raw]})
            return

        if format_name == "select":
            text_value = str(value).strip()
            if text_value:
                properties.append({"key": key, "select": text_value})
            return

        if format_name == "multi_select":
            if isinstance(value, list):
                options = [str(item).strip() for item in value if str(item).strip()]
            else:
                options = [part.strip() for part in str(value).split(",") if part.strip()]
            if options:
                properties.append({"key": key, "multi_select": options})
            return

        if format_name == "objects":
            object_ids, unresolved = self._relation_resolver._resolve_relation_object_ids(
                space_id=space_id,
                raw=value,
                relation_key=key,
            )
            if object_ids:
                properties.append({"key": key, "objects": object_ids})
            if unresolved and warn_on_unresolved_objects:
                warnings.append(f"property_objects_unresolved:{key}:{'|'.join(unresolved)}")
            return

        text_value = str(value).strip()
        if text_value:
            properties.append({"key": key, "text": text_value})


# ---------------------------------------------------------------------------
# Helper class 2: RelationResolver
# ---------------------------------------------------------------------------

class RelationResolver:
    """Resolves relation/tag normalization and object ID lookups."""

    def __init__(
        self,
        anytype_client: AnytypeClient,
        relation_mode: str,
        relation_targets_raw: Any = None,
    ) -> None:
        self._client = anytype_client
        self._relation_mode = relation_mode
        self._relation_targets = self._normalize_relation_targets(relation_targets_raw)
        self._object_name_cache: dict[tuple[str, str, str], str] = {}
        self._object_cache_lock = threading.Lock()

    def _resolve_relation_object_ids(
        self,
        *,
        space_id: str,
        raw: Any,
        relation_key: str = "",
    ) -> tuple[List[str], List[str]]:
        tokens: List[str] = []
        if isinstance(raw, list):
            tokens = [str(item).strip() for item in raw if str(item).strip()]
        else:
            tokens = [part.strip() for part in str(raw).split(",") if part.strip()]

        resolved: List[str] = []
        unresolved: List[str] = []
        target_types = self._relation_target_types(relation_key)
        for token in tokens:
            token_lower = token.lower()
            if token_lower.startswith("bafy"):
                resolved.append(token)
                continue
            object_id = self._lookup_object_id_by_name(
                space_id,
                token,
                relation_key=relation_key,
                preferred_type_keys=target_types,
            )
            if object_id:
                resolved.append(object_id)
            else:
                unresolved.append(token)

        return _ordered_dedup(resolved), unresolved

    def _lookup_object_id_by_name(
        self,
        space_id: str,
        name: str,
        *,
        relation_key: str = "",
        preferred_type_keys: Optional[List[str]] = None,
    ) -> str:
        normalized = str(name or "").strip()
        if not normalized:
            return ""
        preferred_key = "|".join(preferred_type_keys or [])
        cache_key = (space_id, relation_key or "", f"{normalized.casefold()}::{preferred_key}")
        with self._object_cache_lock:
            if cache_key in self._object_name_cache:
                return self._object_name_cache[cache_key]
        object_id = self._client.find_object_id_by_name_with_type(
            space_id=space_id,
            name=normalized,
            preferred_type_keys=preferred_type_keys,
        )
        if object_id:
            with self._object_cache_lock:
                self._object_name_cache[cache_key] = object_id
            return object_id
        return ""

    def _normalize_relation_targets(self, raw: Any) -> Dict[str, List[str]]:
        normalized: Dict[str, List[str]] = {
            key: list(values)
            for key, values in DEFAULT_RELATION_TARGETS.items()
        }
        if not isinstance(raw, dict):
            return normalized

        for raw_key, raw_values in raw.items():
            key = str(raw_key or "").strip().lower()
            if not key:
                continue
            values: List[str] = []
            if isinstance(raw_values, list):
                values = [str(item).strip().lower() for item in raw_values if str(item).strip()]
            elif isinstance(raw_values, str):
                values = [part.strip().lower() for part in raw_values.split(",") if part.strip()]
            if not values:
                continue
            normalized[key] = _ordered_dedup(values)
        return normalized

    def _relation_target_types(self, relation_key: str) -> List[str]:
        if self._relation_mode != "resolve_only":
            return []
        key = str(relation_key or "").strip().lower()
        if not key:
            return []
        return list(self._relation_targets.get(key, []))

    def _normalize_tag_names(self, raw: Any) -> List[str]:
        if raw is None:
            return []
        values: List[str]
        if isinstance(raw, list):
            values = [str(item).strip() for item in raw]
        else:
            values = [part.strip() for part in str(raw).split(",")]
        dedup: List[str] = []
        seen = set()
        for value in values:
            if not value:
                continue
            key = value.casefold()
            if key in seen:
                continue
            seen.add(key)
            dedup.append(value)
        return dedup

    def _normalize_tag_color(self, raw: Any) -> str:
        normalized = str(raw or "grey").strip().lower()
        allowed = {
            "grey",
            "gray",
            "red",
            "orange",
            "yellow",
            "green",
            "cyan",
            "blue",
            "purple",
            "pink",
            "brown",
        }
        return normalized if normalized in allowed else "grey"

    def _normalize_custom_fields(self, raw: Any) -> Dict[str, str]:
        if not isinstance(raw, dict):
            return {}
        cleaned: Dict[str, str] = {}
        for key, value in raw.items():
            normalized_key = str(key or "").strip()
            if not normalized_key:
                continue
            normalized_value = str(value or "").strip()
            if not normalized_value:
                continue
            cleaned[normalized_key] = normalized_value
        return cleaned

    def _ensure_and_resolve_tag_options(
        self,
        space_id: str,
        tag_names: List[str],
    ) -> tuple[List[str], List[str]]:
        if not tag_names:
            return [], []

        warnings: List[str] = []
        tag_property = self._client.get_property_by_key(space_id, "tag")
        if not tag_property or not tag_property.get("id"):
            warnings.append("tag_property_missing")
            return [], warnings

        property_id = str(tag_property["id"])
        try:
            existing_tags = self._client.list_tags(space_id=space_id, property_id=property_id)
        except Exception as exc:
            warnings.append(f"list_tags_failed:{exc}")
            return [], warnings

        by_name = {
            str(item.get("name") or "").strip().casefold(): item
            for item in existing_tags
            if str(item.get("name") or "").strip()
        }
        resolved_options: List[str] = []
        for tag_name in tag_names:
            lookup = tag_name.casefold()
            tag_obj = by_name.get(lookup)
            if tag_obj is None:
                try:
                    created = self._client.create_tag(
                        space_id=space_id,
                        property_id=property_id,
                        name=tag_name,
                    )
                    tag_obj = created.get("tag") or created
                    if not tag_obj:
                        warnings.append(f"create_tag_empty:{tag_name}")
                        continue
                    by_name[lookup] = tag_obj
                except Exception as exc:
                    warnings.append(f"create_tag_failed:{tag_name}:{exc}")
                    continue

            tag_id = str(tag_obj.get("id") or "").strip()
            tag_key = str(tag_obj.get("key") or "").strip()
            if tag_key:
                resolved_options.append(tag_key)
                continue
            if tag_id:
                resolved_options.append(tag_id)
                continue
            warnings.append(f"tag_option_missing:{tag_name}")

        return resolved_options, warnings


# ---------------------------------------------------------------------------
# Helper class 3: DeduplicationEngine
# ---------------------------------------------------------------------------

class DeduplicationEngine:
    """Handles dedup signature computation, caching, and duplicate source checking."""

    def __init__(
        self,
        anytype_client: AnytypeClient,
        dedup_ttl_sec: int,
    ) -> None:
        self._client = anytype_client
        self._dedup_ttl_sec = dedup_ttl_sec
        self._dedup_nonce: dict[str, Dict[str, Any]] = {}
        self._dedup_signature: dict[str, Dict[str, Any]] = {}
        self._dedup_lock = threading.Lock()

    def check_duplicate(self, payload: Dict[str, Any], resolve_space_id_fn) -> Dict[str, Any]:
        url = str(payload.get("url") or "").strip()
        if not url:
            raise RequestError("缺少 url")
        if not url.lower().startswith(("http://", "https://")):
            raise RequestError("url 只接受 http/https")
        space_id = resolve_space_id_fn(payload)
        normalized_url = self._normalize_source_url(url)
        matches = self._check_duplicate_source(space_id=space_id, url=normalized_url)
        return {
            "status": "ok",
            "space_id": space_id,
            "url": normalized_url,
            "exists": bool(matches),
            "matches": matches,
        }

    def _check_duplicate_source(self, *, space_id: str, url: str) -> List[Dict[str, Any]]:
        return self._client.find_objects_by_source_url(
            space_id=space_id,
            source_url=url,
            limit=20,
        )

    def _normalize_source_url(self, raw_url: str) -> str:
        parsed = urlparse(raw_url.strip())
        scheme = parsed.scheme.lower()
        netloc = parsed.netloc.lower()
        path = parsed.path or "/"
        if path != "/" and path.endswith("/"):
            path = path[:-1]
        return urlunparse((scheme, netloc, path, "", parsed.query, ""))

    def _compute_dedup_signature(
        self,
        *,
        space_id: str,
        normalized_url: str,
        title: str,
        markdown: str,
    ) -> str:
        digest = hashlib.sha256()
        digest.update(space_id.encode("utf-8"))
        digest.update(b"\n")
        digest.update(normalized_url.encode("utf-8"))
        digest.update(b"\n")
        digest.update((title or "").strip().encode("utf-8"))
        digest.update(b"\n")
        digest.update((markdown or "").strip().encode("utf-8"))
        return digest.hexdigest()

    def _consume_dedup_cache(
        self,
        *,
        request_nonce: str,
        signature: str,
    ) -> tuple[Optional[Dict[str, Any]], str]:
        with self._dedup_lock:
            self._purge_dedup_cache_locked()
            if request_nonce:
                entry = self._dedup_nonce.get(request_nonce)
                if entry:
                    return dict(entry.get("response") or {}), "nonce_replay"
            entry = self._dedup_signature.get(signature)
            if entry:
                return dict(entry.get("response") or {}), "content_replay"
        return None, "none"

    def _record_dedup_cache(
        self,
        *,
        request_nonce: str,
        signature: str,
        response: Dict[str, Any],
    ) -> None:
        now = time.time()
        entry = {
            "ts": now,
            "response": dict(response),
        }
        with self._dedup_lock:
            self._purge_dedup_cache_locked()
            self._dedup_signature[signature] = entry
            if request_nonce:
                self._dedup_nonce[request_nonce] = entry

    def _purge_dedup_cache_locked(self) -> None:
        cutoff = time.time() - max(1, self._dedup_ttl_sec)
        for store in (self._dedup_nonce, self._dedup_signature):
            expired = [key for key, item in store.items() if float(item.get("ts") or 0) < cutoff]
            for key in expired:
                store.pop(key, None)


# ---------------------------------------------------------------------------
# Orchestrator: ClipperApp
# ---------------------------------------------------------------------------

class ClipperApp:
    def __init__(self, config: Dict[str, Any], auth_token: str = "") -> None:
        self.config = config
        self._auth_token = auth_token
        self._type_ready_spaces: set[str] = set()
        self._type_lock = threading.Lock()

        anytype_cfg = config.get("anytype", {})
        self._relation_mode = str(anytype_cfg.get("relation_mode") or "resolve_only").strip().lower()

        # API key 載入優先順序：env var → .env 檔 → data/.api_key（challenge 流程）
        api_key = (
            os.getenv("ANYTYPE_API_KEY", "").strip()
            or _load_env_value("ANYTYPE_API_KEY")
            or _load_api_key_file()
        )
        self._anytype_base_url = os.getenv("ANYTYPE_BASE_URL", DEFAULT_BASE_URL)
        self._anytype_api_version = os.getenv("ANYTYPE_API_VERSION", DEFAULT_API_VERSION)
        if api_key:
            self.anytype_client: Optional[AnytypeClient] = self._make_anytype_client(api_key)
        else:
            self.anytype_client = None  # 等待 challenge 流程完成後再初始化

        # Initialize helpers (require anytype_client for full operation;
        # they are re-created when client changes via solve_challenge)
        self._init_helpers(anytype_cfg)

        queue_cfg = config["image_backup"]
        self.image_queue = ImageBackupQueue(
            cache_dir=Path(queue_cfg["cache_dir"]).resolve(),
            max_workers=int(queue_cfg["max_workers"]),
            timeout_sec=int(queue_cfg["timeout_sec"]),
            retries=int(queue_cfg["retries"]),
        )

    def _init_helpers(self, anytype_cfg: Dict[str, Any] | None = None) -> None:
        """Create or re-create helper instances bound to the current anytype_client."""
        if anytype_cfg is None:
            anytype_cfg = self.config.get("anytype", {})

        # RelationResolver must be created first (PropertyManager depends on it)
        if self.anytype_client is not None:
            self.relation_resolver = RelationResolver(
                anytype_client=self.anytype_client,
                relation_mode=self._relation_mode,
                relation_targets_raw=anytype_cfg.get("relation_targets"),
            )
            self.property_manager = PropertyManager(
                anytype_client=self.anytype_client,
                relation_resolver=self.relation_resolver,
            )
            self.dedup_engine = DeduplicationEngine(
                anytype_client=self.anytype_client,
                dedup_ttl_sec=int(self.config.get("clip", {}).get("dedup_ttl_sec", 120)),
            )
        else:
            # Placeholders — will be replaced once solve_challenge sets the client
            self.relation_resolver = None  # type: ignore[assignment]
            self.property_manager = None  # type: ignore[assignment]
            self.dedup_engine = None  # type: ignore[assignment]

    def _make_anytype_client(self, api_key: str) -> AnytypeClient:
        return AnytypeClient(
            api_key=api_key,
            base_url=self._anytype_base_url,
            api_version=self._anytype_api_version,
            type_key=self.config["anytype"]["type_key"],
            type_name=self.config["anytype"]["type_name"],
            type_plural_name=self.config["anytype"]["type_plural_name"],
            type_layout=self.config["anytype"]["type_layout"],
        )

    @property
    def setup_required(self) -> bool:
        return self.anytype_client is None

    def check_auth(self, auth_header: str) -> bool:
        """Validate Bearer token. Empty token = open access."""
        if not self._auth_token:
            return True
        if not auth_header.startswith("Bearer "):
            return False
        return secrets.compare_digest(auth_header[7:], self._auth_token)

    def request_challenge(self) -> Dict[str, Any]:
        """向 Anytype 發起 challenge，回傳 challenge_id（Anytype 桌面版會顯示 4 碼）。"""
        url = f"{self._anytype_base_url}/v1/auth/challenges"
        try:
            resp = requests.post(
                url,
                json={"app_name": "Anytype Web Clipper"},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
            challenge_id = str(data.get("challenge_id") or data.get("challengeId") or "").strip()
            if not challenge_id:
                raise RequestError("Anytype 未回傳 challenge_id", status_code=502)
            return {"challenge_id": challenge_id}
        except requests.RequestException as exc:
            raise RequestError(f"無法連線 Anytype：{exc}", status_code=502) from exc

    def solve_challenge(self, challenge_id: str, code: str) -> Dict[str, Any]:
        """提交 4 碼驗證碼換取 API key，並持久化到 data/.api_key。"""
        if not challenge_id or not code:
            raise RequestError("challenge_id 和 code 不可為空")
        url = f"{self._anytype_base_url}/v1/auth/api_keys"
        try:
            resp = requests.post(
                url,
                json={"challenge_id": challenge_id, "code": code},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
            api_key = str(data.get("api_key") or data.get("apiKey") or "").strip()
            if not api_key:
                raise RequestError("Anytype 未回傳 api_key", status_code=502)
        except requests.HTTPError as exc:
            raise RequestError(f"驗證碼錯誤或已過期：{exc}", status_code=400) from exc
        except requests.RequestException as exc:
            raise RequestError(f"無法連線 Anytype：{exc}", status_code=502) from exc

        _save_api_key_file(api_key)
        self.anytype_client = self._make_anytype_client(api_key)
        self._init_helpers()
        self._type_ready_spaces.clear()
        return {"ok": True}

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "service": "anytype-clipper-mvp",
            "time": datetime.now(timezone.utc).isoformat(),
        }

    def get_options(self, preferred_space_id: str = "") -> Dict[str, Any]:
        if self.anytype_client is None:
            return {"setup_required": True}
        spaces_raw = self.anytype_client.list_spaces()
        spaces: List[Dict[str, str]] = []
        for item in spaces_raw:
            sid = str(item.get("id") or item.get("space_id") or "").strip()
            if not sid:
                continue
            name = str(item.get("name") or item.get("title") or sid).strip()
            spaces.append({"id": sid, "name": name})

        if not spaces:
            raise RequestError("Anytype 沒有可用 space", status_code=500)

        env_space_id = os.getenv("ANYTYPE_SPACE_ID", "").strip()
        resolved_space_id = self.anytype_client.resolve_space_id(
            preferred_space_id.strip() or env_space_id
        )
        if not any(space["id"] == resolved_space_id for space in spaces):
            resolved_space_id = spaces[0]["id"]

        warnings: List[str] = []
        try:
            self._ensure_type(resolved_space_id)
        except Exception as exc:
            warnings.append(f"ensure_type_failed:{exc}")

        types_raw = self.anytype_client.list_types(resolved_space_id)
        types: List[Dict[str, Any]] = []
        for item in types_raw:
            key = str(item.get("key") or "").strip()
            if not key:
                continue
            if bool(item.get("archived")):
                continue
            name = str(item.get("name") or key).strip()
            icon = item.get("icon") or {}
            icon_payload = {
                "format": "",
                "emoji": "",
                "name": "",
                "color": "",
            }
            if isinstance(icon, dict):
                icon_payload = {
                    "format": str(icon.get("format") or "").strip(),
                    "emoji": str(icon.get("emoji") or "").strip(),
                    "name": str(icon.get("name") or "").strip(),
                    "color": str(icon.get("color") or "").strip(),
                }
            types.append(
                {
                    "key": key,
                    "name": name,
                    "icon_emoji": icon_payload["emoji"],
                    "icon": icon_payload,
                }
            )

        if not types:
            types = [
                {
                    "key": "page",
                    "name": "Page",
                    "icon_emoji": "",
                    "icon": {"format": "", "emoji": "", "name": "", "color": ""},
                }
            ]

        configured_type = str(self.config["anytype"]["type_key"]).strip()
        if configured_type and any(t["key"] == configured_type for t in types):
            default_type_key = configured_type
        elif any(t["key"] == "bookmark" for t in types):
            default_type_key = "bookmark"
        else:
            fallback_type_key = str(self.config["anytype"].get("fallback_type_key", "")).strip()
            if fallback_type_key and any(t["key"] == fallback_type_key for t in types):
                default_type_key = fallback_type_key
            else:
                default_type_key = types[0]["key"]

        tags: List[Dict[str, str]] = []
        try:
            tag_property = self.anytype_client.get_property_by_key(resolved_space_id, "tag")
            if tag_property and tag_property.get("id"):
                for tag in self.anytype_client.list_tags(
                    space_id=resolved_space_id,
                    property_id=str(tag_property["id"]),
                ):
                    tag_id = str(tag.get("id") or "").strip()
                    tag_name = str(tag.get("name") or "").strip()
                    tag_key = str(tag.get("key") or "").strip()
                    tag_color = str(tag.get("color") or "").strip()
                    if not tag_id or not tag_name:
                        continue
                    tags.append(
                        {
                            "id": tag_id,
                            "key": tag_key,
                            "name": tag_name,
                            "color": tag_color,
                        }
                    )
        except Exception as exc:
            warnings.append(f"list_tags_failed:{exc}")

        return {
            "setup_required": False,
            "spaces": spaces,
            "types": types,
            "tags": tags,
            "defaults": {
                "space_id": resolved_space_id,
                "type_key": default_type_key,
            },
            "features": {
                "add_page_content_always_on": True,
            },
            "custom_fields": [],
            "warnings": warnings,
        }

    def handle_clip(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if self.anytype_client is None:
            raise RequestError("尚未完成 Anytype 連線設定，請先完成驗證流程", status_code=503)
        url = str(payload.get("url", "")).strip()
        if not url:
            raise RequestError("缺少 url")
        if not url.lower().startswith(("http://", "https://")):
            raise RequestError("url 只接受 http/https")

        html = str(payload.get("html", "") or "")
        options = payload.get("options") or {}
        if not isinstance(options, dict):
            options = {}

        if not html.strip():
            html = self._fetch_html(url)
        if not html.strip():
            raise RequestError("無法取得網頁內容", status_code=422)

        max_chars = int(self.config["clip"]["max_html_chars"])
        html = html[:max_chars]
        preferred_title = str(payload.get("title", "")).strip()

        extraction = extract_article(url=url, html=html, preferred_title=preferred_title)
        cleaned = clean_to_markdown(
            extraction,
            read_time_wpm=int(self.config["clip"]["read_time_wpm"]),
        )
        if not cleaned.markdown:
            raise RequestError("抽取後內容為空", status_code=422)

        warnings = extraction.warnings[:]
        space_id = self._resolve_space_id(payload)
        normalized_url = self.dedup_engine._normalize_source_url(extraction.url)
        clip_title = _resolve_clip_title(
            preferred_title=preferred_title,
            extracted_title=str(extraction.title or ""),
            normalized_url=normalized_url,
        )
        primary_type_key = str(self.config["anytype"]["type_key"]).strip()
        requested_type_key = str(payload.get("type_key") or payload.get("save_as") or "").strip()
        fallback_type_key = str(self.config["anytype"].get("fallback_type_key", "")).strip()
        selected_type_key = requested_type_key or primary_type_key
        duplicate_strategy = str(payload.get("duplicate_strategy") or "create").strip().lower()
        if duplicate_strategy not in {"ask", "update", "create"}:
            duplicate_strategy = "create"
        duplicate_target_object_id = str(payload.get("duplicate_target_object_id") or "").strip()
        request_nonce = str(payload.get("request_nonce") or "").strip()

        if selected_type_key == primary_type_key:
            try:
                self._ensure_type(space_id)
            except Exception as exc:
                if fallback_type_key:
                    selected_type_key = fallback_type_key
                    warnings.append(f"ensure_type_failed_fallback:{exc}")
                else:
                    raise

        backup_enabled = bool(self.config["image_backup"]["enabled"])
        save_images = (
            bool(options.get("save_images", self.config["clip"]["include_images"]))
            and backup_enabled
        )
        image_urls = cleaned.image_urls if save_images else []

        tag_names = self.relation_resolver._normalize_tag_names(
            payload.get("tag_names", payload.get("tags"))
        )
        tag_options, tag_warnings = self.relation_resolver._ensure_and_resolve_tag_options(
            space_id, tag_names
        )
        warnings.extend(tag_warnings)
        tags_text = ", ".join(tag_names)
        custom_fields = self.relation_resolver._normalize_custom_fields(
            payload.get("custom_fields")
        )
        icon_emoji = self._resolve_icon_emoji(
            payload=payload,
            extraction=extraction,
            selected_type_key=selected_type_key,
        )

        signature = self.dedup_engine._compute_dedup_signature(
            space_id=space_id,
            normalized_url=normalized_url,
            title=clip_title,
            markdown=cleaned.markdown,
        )
        cached, dedup_reason = self.dedup_engine._consume_dedup_cache(
            request_nonce=request_nonce,
            signature=signature,
        )
        if cached:
            replay = dict(cached)
            replay["dedup_applied"] = True
            replay["dedup_reason"] = dedup_reason
            return replay

        duplicates = self.dedup_engine._check_duplicate_source(
            space_id=space_id, url=normalized_url
        )
        if duplicate_strategy == "ask" and duplicates:
            raise RequestError(
                "duplicate_found: 請先呼叫 /api/clip/check-duplicate 並選擇 update 或 create",
                status_code=409,
            )
        if duplicate_strategy == "update" and not duplicate_target_object_id:
            if duplicates:
                duplicate_target_object_id = str(duplicates[0].get("object_id") or "").strip()
            if not duplicate_target_object_id:
                raise RequestError("duplicate_target_object_id 缺失，無法更新既有物件", status_code=422)

        properties, property_warnings = self.property_manager._build_properties(
            space_id=space_id,
            extraction=extraction,
            selected_type_key=selected_type_key,
            read_time_min=cleaned.read_time_min,
            tags_text=tags_text,
            tag_options=tag_options,
            custom_fields=custom_fields,
        )
        warnings.extend(property_warnings)
        properties, dropped_keys = self.property_manager._filter_supported_properties(
            space_id, properties
        )
        if dropped_keys:
            warnings.append(f"dropped_unknown_properties:{','.join(dropped_keys)}")
        action = "created"
        icon_payload = {"format": "emoji", "emoji": icon_emoji} if icon_emoji else None
        if duplicate_strategy == "update":
            self.anytype_client.update_clip_object(
                space_id=space_id,
                object_id=duplicate_target_object_id,
                title=clip_title,
                markdown=cleaned.markdown,
                properties=properties,
                icon=icon_payload,
            )
            object_id = duplicate_target_object_id
            action = "updated"
        else:
            try:
                object_id = self.anytype_client.create_clip_object(
                    space_id=space_id,
                    title=clip_title,
                    markdown=cleaned.markdown,
                    properties=properties,
                    type_key=selected_type_key,
                    icon=icon_payload,
                )
            except Exception as exc:
                can_retry = fallback_type_key and selected_type_key != fallback_type_key
                if not can_retry:
                    raise
                warnings.append(f"create_failed_retry_fallback:{exc}")
                object_id = self.anytype_client.create_clip_object(
                    space_id=space_id,
                    title=clip_title,
                    markdown=cleaned.markdown,
                    properties=properties,
                    type_key=fallback_type_key,
                    icon=icon_payload,
                )

        if image_urls:
            self.image_queue.enqueue(
                space_id=space_id,
                object_id=object_id,
                image_urls=image_urls,
            )

        if not image_urls and save_images:
            warnings.append("no_images_detected")

        result = {
            "status": "ok",
            "object_id": object_id,
            "space_id": space_id,
            "action": action,
            "open_url": self._build_open_url(space_id=space_id, object_id=object_id),
            "stats": {
                "chars": len(extraction.text_content),
                "images": len(extraction.image_urls),
                "embedded_media": len(extraction.embedded_urls),
                "images_queued": len(image_urls),
                "word_count": cleaned.word_count,
                "read_time_min": cleaned.read_time_min,
            },
            "warnings": warnings,
            "dedup_applied": False,
            "dedup_reason": "none",
        }
        self.dedup_engine._record_dedup_cache(
            request_nonce=request_nonce,
            signature=signature,
            response=result,
        )
        return result

    def _resolve_space_id(self, payload: Dict[str, Any]) -> str:
        preferred_space = str(payload.get("space_id", "")).strip()
        if not preferred_space:
            preferred_space = os.getenv("ANYTYPE_SPACE_ID", "").strip()
        return self.anytype_client.resolve_space_id(preferred_space)

    def _ensure_type(self, space_id: str) -> None:
        if space_id in self._type_ready_spaces:
            return
        with self._type_lock:
            if space_id in self._type_ready_spaces:
                return
            self.anytype_client.ensure_web_clip_type(space_id)
            self.property_manager._refresh_space_properties(space_id)
            self._type_ready_spaces.add(space_id)

    def update_tag(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        space_id = self._resolve_space_id(payload)
        new_name = str(payload.get("new_name") or "").strip()
        if not new_name:
            raise RequestError("缺少 new_name")
        color = self.relation_resolver._normalize_tag_color(payload.get("color"))
        tag_property = self.anytype_client.get_property_by_key(space_id, "tag")
        if not tag_property or not tag_property.get("id"):
            raise RequestError("tag_property_missing", status_code=422)
        property_id = str(tag_property["id"])

        target_tag_id = str(payload.get("tag_id") or "").strip()
        old_name = str(payload.get("old_name") or "").strip().casefold()
        tags = self.anytype_client.list_tags(space_id=space_id, property_id=property_id)
        target_tag: Dict[str, Any] | None = None
        for tag in tags:
            tag_id = str(tag.get("id") or "").strip()
            tag_name = str(tag.get("name") or "").strip().casefold()
            if target_tag_id and tag_id == target_tag_id:
                target_tag = tag
                break
            if not target_tag_id and old_name and tag_name == old_name:
                target_tag = tag
                break
        if not target_tag:
            raise RequestError("tag_not_found", status_code=404)

        updated = self.anytype_client.update_tag(
            space_id=space_id,
            property_id=property_id,
            tag_id=str(target_tag.get("id") or ""),
            name=new_name,
            color=color,
        )
        tag = updated.get("tag") or updated
        return {
            "status": "ok",
            "space_id": space_id,
            "tag": {
                "id": str(tag.get("id") or ""),
                "key": str(tag.get("key") or ""),
                "name": str(tag.get("name") or new_name),
                "color": str(tag.get("color") or color),
            },
        }

    def check_duplicate(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.dedup_engine.check_duplicate(payload, self._resolve_space_id)

    def _build_open_url(self, *, space_id: str, object_id: str) -> str:
        if not object_id:
            return ""
        return f"anytype://object/{object_id}?space={space_id}"

    def _resolve_icon_emoji(
        self,
        *,
        payload: Dict[str, Any],
        extraction,
        selected_type_key: str,
    ) -> str:
        explicit = str(payload.get("icon_emoji") or "").strip()
        if explicit:
            return explicit

        return ""

    def _fetch_html(self, url: str) -> str:
        timeout_sec = int(self.config["clip"]["request_timeout_sec"])
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
            )
        }
        try:
            response = requests.get(url, timeout=timeout_sec, headers=headers)
            if response.status_code >= 400:
                raise RequestError(f"抓取網頁失敗：HTTP {response.status_code}", status_code=422)
            return response.text
        except RequestError:
            raise
        except Exception as exc:
            raise RequestError(f"抓取網頁失敗：{exc}", status_code=422) from exc

class ClipperRequestHandler(BaseHTTPRequestHandler):
    server: "ClipperHttpServer"

    def _is_authorized(self) -> bool:
        auth_header = self.headers.get("Authorization", "")
        return self.server.app.check_auth(auth_header)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._write_json(204, {})

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            self._write_json(200, self.server.app.health())
            return
        if not self._is_authorized():
            self._write_json(401, {"error": "unauthorized"})
            return
        if parsed.path == "/api/options":
            try:
                query = parse_qs(parsed.query or "")
                space_id = str(query.get("space_id", [""])[0]).strip()
                result = self.server.app.get_options(space_id)
                self._write_json(200, result)
            except RequestError as exc:
                self._write_json(exc.status_code, {"error": str(exc)})
            except Exception as exc:  # pragma: no cover - runtime safeguard
                self._write_json(500, {"error": f"internal_error: {exc}"})
            return
        self._write_json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        _auth_free_paths = ("/api/auth/challenge", "/api/auth/solve")
        _protected_paths = ("/api/clip", "/api/clip/check-duplicate", "/api/tag/update")

        if parsed.path not in _auth_free_paths + _protected_paths:
            self._write_json(404, {"error": "not_found"})
            return

        # challenge/solve 不需要 auth（用於初始設定）
        if parsed.path not in _auth_free_paths and not self._is_authorized():
            self._write_json(401, {"error": "unauthorized"})
            return

        try:
            body = self._read_json_body()
            if parsed.path == "/api/auth/challenge":
                result = self.server.app.request_challenge()
            elif parsed.path == "/api/auth/solve":
                challenge_id = str(body.get("challenge_id") or "").strip()
                code = str(body.get("code") or "").strip()
                result = self.server.app.solve_challenge(challenge_id, code)
            elif parsed.path == "/api/clip/check-duplicate":
                result = self.server.app.check_duplicate(body)
            elif parsed.path == "/api/tag/update":
                result = self.server.app.update_tag(body)
            else:
                result = self.server.app.handle_clip(body)
            self._write_json(200, result)
        except RequestError as exc:
            self._write_json(exc.status_code, {"error": str(exc)})
        except json.JSONDecodeError:
            self._write_json(400, {"error": "JSON 格式錯誤"})
        except Exception as exc:  # pragma: no cover - runtime safeguard
            self._write_json(500, {"error": f"internal_error: {exc}"})

    def _read_json_body(self) -> Dict[str, Any]:
        length_raw = self.headers.get("Content-Length", "0").strip()
        length = int(length_raw) if length_raw.isdigit() else 0
        raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise RequestError("request body 必須為 JSON object")
        return payload

    def _write_json(self, status_code: int, payload: Dict[str, Any]) -> None:
        content = b"" if status_code == 204 else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        origin = self.headers.get("Origin", "")
        allowed_prefixes = ("chrome-extension://", "http://127.0.0.1", "http://localhost")
        cors_origin = origin if any(origin.startswith(p) for p in allowed_prefixes) else ""
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if cors_origin:
            self.send_header("Access-Control-Allow-Origin", cors_origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Cache-Control", "no-store")
        if status_code != 204:
            self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        if status_code != 204:
            self.wfile.write(content)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        print(f"[clipper] {self.address_string()} - {format % args}")


class ClipperHttpServer(ThreadingHTTPServer):
    def __init__(self, server_address, request_handler_class, app: ClipperApp):
        super().__init__(server_address, request_handler_class)
        self.app = app


def _normalize_iso_datetime(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    candidate = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
        return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat()
    except Exception:
        return ""


def _resolve_clip_title(
    *,
    preferred_title: str,
    extracted_title: str,
    normalized_url: str,
) -> str:
    preferred = str(preferred_title or "").strip()
    if preferred:
        return preferred

    extracted = str(extracted_title or "").strip()
    if extracted.casefold() in {"untitled", "untitled clip", "未命名"}:
        extracted = ""
    if extracted:
        return extracted

    fallback_url = str(normalized_url or "").strip()
    if fallback_url:
        return fallback_url
    return "Clip"


_API_KEY_FILE = Path(__file__).resolve().parent / "data" / ".api_key"


def _load_api_key_file() -> str:
    """從 data/.api_key 讀取 challenge 流程存入的 API key。"""
    try:
        if _API_KEY_FILE.exists():
            return _API_KEY_FILE.read_text(encoding="utf-8").strip()
    except Exception:
        pass
    return ""


def _save_api_key_file(api_key: str) -> None:
    """將 API key 持久化到 data/.api_key。"""
    _API_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    _API_KEY_FILE.write_text(api_key.strip(), encoding="utf-8")


def _load_env_value(key: str) -> str:
    env_file = Path(__file__).resolve().parents[2] / ".env"
    if not env_file.exists():
        return ""
    try:
        for raw in env_file.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[7:].strip()
            k, v = line.split("=", 1)
            if k.strip() == key:
                return v.strip().strip("'\"")
    except Exception:
        return ""
    return ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Anytype Web Clipper Local Service")
    parser.add_argument("--host", default="", help="預設讀取 config.server.host")
    parser.add_argument("--port", type=int, default=0, help="預設讀取 config.server.port")
    parser.add_argument("--config", default="", help="自訂設定檔路徑 (YAML)")
    parser.add_argument("--auth-token", default="", dest="auth_token", help="覆蓋 config 或自動產生的 token")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = load_config(args.config or None)

    host = args.host or str(config["server"]["host"])
    port = args.port or int(config["server"]["port"])

    auth_token = args.auth_token or str(config["server"].get("auth_token", "")).strip()
    # 不自動產生 token → check_auth() 在 _auth_token 為空時直接放行（open access）

    app = ClipperApp(config, auth_token=auth_token)
    server = ClipperHttpServer((host, port), ClipperRequestHandler, app)
    print("=" * 50)
    print("  Anytype Web Clipper Service v1.0.0")
    print(f"  URL:   http://{host}:{port}")
    if auth_token:
        print(f"  Token: {auth_token}")
        print("  Paste the token into extension Options page.")
    else:
        print("  Auth:  open access mode（無 token 限制）")
    print("=" * 50)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("[clipper] server stopped")


if __name__ == "__main__":
    main()

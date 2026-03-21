from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEFAULT_BASE_URL = "http://127.0.0.1:31009"
DEFAULT_API_VERSION = "2025-11-08"

WEB_CLIP_PROPERTIES: List[Dict[str, str]] = [
    {"key": "source_url", "name": "Source URL", "format": "url"},
    {"key": "author", "name": "Author", "format": "text"},
    {"key": "media", "name": "Media", "format": "text"},
    {"key": "published_at", "name": "Published At", "format": "date"},
    {"key": "captured_at", "name": "Captured At", "format": "date"},
    {"key": "excerpt", "name": "Excerpt", "format": "text"},
    {"key": "cover_image_url", "name": "Cover Image URL", "format": "url"},
    {"key": "embedded_media_urls", "name": "Embedded Media URLs", "format": "text"},
    {"key": "read_time_min", "name": "Read Time (min)", "format": "number"},
]


class AnytypeObjectFinder:
    """Search/lookup utilities extracted from AnytypeClient."""

    def __init__(self, client: AnytypeClient) -> None:
        self._client = client

    def find_object_id_by_name(self, *, space_id: str, name: str) -> Optional[str]:
        return self.find_object_id_by_name_with_type(
            space_id=space_id,
            name=name,
            preferred_type_keys=None,
        )

    def find_object_id_by_name_with_type(
        self,
        *,
        space_id: str,
        name: str,
        preferred_type_keys: Optional[List[str]] = None,
    ) -> Optional[str]:
        normalized = name.strip()
        if not normalized:
            return None
        candidates = self._client.search_space_objects(
            space_id=space_id, query=normalized, limit=20
        )
        if not candidates:
            return None
        target = normalized.casefold()
        preferred = {
            str(item).strip().casefold()
            for item in (preferred_type_keys or [])
            if str(item).strip()
        }
        exact_matches: List[Dict[str, Any]] = []
        for item in candidates:
            candidate_name = str(item.get("name") or "").strip()
            object_id = str(item.get("id") or "").strip()
            if object_id and candidate_name.casefold() == target:
                exact_matches.append(item)

        if not exact_matches:
            return None

        if preferred:
            preferred_match = self._pick_candidate_by_type(
                space_id=space_id,
                candidates=exact_matches,
                preferred_type_keys=preferred,
            )
            if preferred_match:
                return preferred_match

        for item in exact_matches:
            object_id = str(item.get("id") or "").strip()
            if object_id:
                return object_id
        return None

    def _pick_candidate_by_type(
        self,
        *,
        space_id: str,
        candidates: List[Dict[str, Any]],
        preferred_type_keys: set[str],
    ) -> str:
        fallback_candidates: List[Dict[str, Any]] = []
        for item in candidates:
            object_id = str(item.get("id") or "").strip()
            if not object_id:
                continue
            type_key = self._extract_type_key(item)
            if type_key and type_key.casefold() in preferred_type_keys:
                return object_id
            fallback_candidates.append(item)

        for item in fallback_candidates:
            object_id = str(item.get("id") or "").strip()
            if not object_id:
                continue
            try:
                full = self._client.get_object(
                    space_id=space_id, object_id=object_id, format_name="basic"
                )
            except Exception:
                continue
            type_key = self._extract_type_key(full)
            if type_key and type_key.casefold() in preferred_type_keys:
                return object_id
        return ""

    @staticmethod
    def _extract_type_key(item: Dict[str, Any]) -> str:
        type_value = item.get("type")
        if isinstance(type_value, dict):
            key = type_value.get("key") or type_value.get("type_key")
            if key:
                return str(key).strip()
        if isinstance(type_value, str):
            return type_value.strip()
        key = item.get("type_key") or item.get("typeKey")
        if key:
            return str(key).strip()
        return ""

    def find_objects_by_source_url(
        self,
        *,
        space_id: str,
        source_url: str,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        normalized = source_url.strip()
        if not normalized:
            return []

        hits = self._client.search_space_objects(
            space_id=space_id, query=normalized, limit=limit
        )
        if not hits:
            # Search-by-query may not index URL text consistently; fallback to recent objects.
            hits = self._client.list_space_objects(
                space_id=space_id, limit=min(max(limit * 10, 120), 400)
            )
        matches: List[Dict[str, Any]] = []
        for hit in hits:
            object_id = str(hit.get("id") or "").strip()
            if not object_id:
                continue
            try:
                full = self._client.get_object(space_id=space_id, object_id=object_id)
            except Exception:
                continue
            properties = full.get("properties") or []
            actual_url = self._extract_source_url(properties)
            if actual_url != normalized:
                continue
            type_info = full.get("type") or {}
            matches.append(
                {
                    "object_id": object_id,
                    "name": str(
                        full.get("name") or hit.get("name") or object_id
                    ).strip(),
                    "updated_at": self._extract_updated_at(properties),
                    "type_key": str(type_info.get("key") or "").strip(),
                }
            )
        matches.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
        return matches

    @staticmethod
    def _extract_source_url(properties: List[Dict[str, Any]]) -> str:
        for item in properties:
            key = str(item.get("key") or "").strip()
            if key not in ("source_url", "source"):
                continue
            value = str(item.get("url") or "").strip()
            if value:
                return value
        return ""

    @staticmethod
    def _extract_updated_at(properties: List[Dict[str, Any]]) -> str:
        candidates = ("last_modified_date", "last_modified", "captured_at", "created_date")
        for key in candidates:
            for item in properties:
                if str(item.get("key") or "").strip() != key:
                    continue
                value = str(item.get("date") or "").strip()
                if value:
                    return value
        return ""


class AnytypeTagAPI:
    """Tag CRUD operations extracted from AnytypeClient."""

    def __init__(self, client: AnytypeClient) -> None:
        self._client = client

    def list_tags(self, *, space_id: str, property_id: str) -> List[Dict[str, Any]]:
        result = self._client._http_json(
            method="GET",
            path=f"/v1/spaces/{space_id}/properties/{property_id}/tags",
        )
        return result.get("data", [])

    def create_tag(
        self,
        *,
        space_id: str,
        property_id: str,
        name: str,
        color: str = "grey",
    ) -> Dict[str, Any]:
        payload = {
            "name": name,
            "color": color,
        }
        return self._client._http_json(
            method="POST",
            path=f"/v1/spaces/{space_id}/properties/{property_id}/tags",
            payload=payload,
        )

    def update_tag(
        self,
        *,
        space_id: str,
        property_id: str,
        tag_id: str,
        name: str,
        color: str,
    ) -> Dict[str, Any]:
        payload = {
            "name": name,
            "color": color,
        }
        return self._client._http_json(
            method="PATCH",
            path=f"/v1/spaces/{space_id}/properties/{property_id}/tags/{tag_id}",
            payload=payload,
        )


class AnytypeClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        api_version: str = DEFAULT_API_VERSION,
        type_key: str = "web_clip",
        type_name: str = "Web Clip",
        type_plural_name: str = "Web Clips",
        type_layout: str = "basic",
    ) -> None:
        if not api_key.strip():
            raise ValueError("ANYTYPE_API_KEY 不可為空")
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        self.api_version = api_version.strip()
        self.type_key = type_key
        self.type_name = type_name
        self.type_plural_name = type_plural_name
        self.type_layout = type_layout

        self._finder = AnytypeObjectFinder(self)
        self._tag_api = AnytypeTagAPI(self)

    def _http_json(
        self,
        *,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
        query: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        url = self.base_url + path
        if query:
            url += "?" + urlencode(query)

        body = None
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Anytype-Version": self.api_version,
        }
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"

        request = Request(url, data=body, headers=headers, method=method.upper())
        try:
            with urlopen(request, timeout=30) as response:
                raw = response.read().decode("utf-8")
                if not raw.strip():
                    return {}
                return json.loads(raw)
        except HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode("utf-8", errors="replace")
            except Exception:
                detail = "<no body>"
            raise RuntimeError(f"{method} {path} failed ({exc.code}): {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"{method} {path} failed: {exc}") from exc

    # --- Space management ---

    def list_spaces(self) -> List[Dict[str, Any]]:
        result = self._http_json(method="GET", path="/v1/spaces")
        return result.get("data", [])

    def resolve_space_id(self, preferred_space_id: str = "") -> str:
        if preferred_space_id.strip():
            return preferred_space_id.strip()
        spaces = self.list_spaces()
        for space in spaces:
            space_id = space.get("id") or space.get("space_id")
            if space_id:
                return str(space_id)
        raise RuntimeError("無法取得 Anytype space_id，請設定 ANYTYPE_SPACE_ID")

    # --- Properties ---

    def list_properties(self, space_id: str) -> Dict[str, Dict[str, Any]]:
        offset = 0
        limit = 100
        merged: Dict[str, Dict[str, Any]] = {}
        while True:
            result = self._http_json(
                method="GET",
                path=f"/v1/spaces/{space_id}/properties",
                query={"offset": offset, "limit": limit},
            )
            data = result.get("data", [])
            for item in data:
                key = item.get("key")
                if key:
                    merged[str(key)] = item

            pagination = result.get("pagination") or {}
            if not pagination.get("has_more"):
                break
            next_offset = int(pagination.get("offset", offset)) + int(
                pagination.get("limit", limit)
            )
            if next_offset <= offset:
                break
            offset = next_offset
        return merged

    def get_property_by_key(self, space_id: str, key: str) -> Optional[Dict[str, Any]]:
        properties = self.list_properties(space_id)
        return properties.get(key)

    def create_property(self, space_id: str, *, key: str, name: str, format_name: str) -> None:
        payload = {"key": key, "name": name, "format": format_name}
        self._http_json(
            method="POST",
            path=f"/v1/spaces/{space_id}/properties",
            payload=payload,
        )

    # --- Types ---

    def list_types(self, space_id: str) -> List[Dict[str, Any]]:
        offset = 0
        limit = 100
        merged: List[Dict[str, Any]] = []
        while True:
            result = self._http_json(
                method="GET",
                path=f"/v1/spaces/{space_id}/types",
                query={"offset": offset, "limit": limit},
            )
            data = result.get("data", [])
            merged.extend(data)
            pagination = result.get("pagination") or {}
            if not pagination.get("has_more"):
                break
            next_offset = int(pagination.get("offset", offset)) + int(
                pagination.get("limit", limit)
            )
            if next_offset <= offset:
                break
            offset = next_offset
        return merged

    def create_type(self, space_id: str, properties: List[Dict[str, str]]) -> None:
        payload = {
            "key": self.type_key,
            "name": self.type_name,
            "plural_name": self.type_plural_name,
            "layout": self.type_layout,
            "properties": properties,
        }
        self._http_json(
            method="POST",
            path=f"/v1/spaces/{space_id}/types",
            payload=payload,
        )

    def ensure_web_clip_type(self, space_id: str) -> None:
        existing_properties = self.list_properties(space_id)
        for spec in WEB_CLIP_PROPERTIES:
            if spec["key"] in existing_properties:
                continue
            try:
                self.create_property(
                    space_id,
                    key=spec["key"],
                    name=spec["name"],
                    format_name=spec["format"],
                )
            except RuntimeError as exc:
                if "already exists" in str(exc):
                    continue
                raise

        existing_types = self.list_types(space_id)
        if any(t.get("key") == self.type_key for t in existing_types):
            return

        try:
            self.create_type(space_id, WEB_CLIP_PROPERTIES)
        except RuntimeError as exc:
            if "already exists" in str(exc):
                return
            raise

    # --- Object CRUD ---

    def search_space_objects(
        self,
        *,
        space_id: str,
        query: str,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        normalized = query.strip()
        if not normalized:
            return []
        payload = {
            "query": normalized,
            "limit": max(1, min(int(limit), 100)),
        }
        result = self._http_json(
            method="POST",
            path=f"/v1/spaces/{space_id}/search",
            payload=payload,
        )
        return result.get("data", [])

    def list_space_objects(self, *, space_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        result = self._http_json(
            method="GET",
            path=f"/v1/spaces/{space_id}/objects",
            query={"offset": 0, "limit": max(1, min(int(limit), 200))},
        )
        return result.get("data", [])

    def get_object(
        self,
        *,
        space_id: str,
        object_id: str,
        format_name: str = "markdown",
    ) -> Dict[str, Any]:
        result = self._http_json(
            method="GET",
            path=f"/v1/spaces/{space_id}/objects/{object_id}",
            query={"format": format_name},
        )
        return result.get("object") or {}

    def create_basic_object(
        self,
        *,
        space_id: str,
        name: str,
        type_key: str = "page",
        icon: Optional[Dict[str, str]] = None,
    ) -> str:
        payload: Dict[str, Any] = {
            "type_key": type_key,
            "name": name,
        }
        if icon:
            payload["icon"] = icon
        created = self._http_json(
            method="POST",
            path=f"/v1/spaces/{space_id}/objects",
            payload=payload,
        )
        object_id = ((created.get("object") or {}).get("id")) or created.get("id")
        if not object_id:
            raise RuntimeError(f"建立 object 失敗，回應：{json.dumps(created, ensure_ascii=False)}")
        return str(object_id)

    def create_clip_object(
        self,
        *,
        space_id: str,
        title: str,
        markdown: str,
        properties: List[Dict[str, Any]],
        type_key: Optional[str] = None,
        icon: Optional[Dict[str, str]] = None,
    ) -> str:
        selected_type = type_key or self.type_key
        create_payload = {
            "type_key": selected_type,
            "name": title,
            "properties": properties,
        }
        if icon:
            create_payload["icon"] = icon
        created = self._http_json(
            method="POST",
            path=f"/v1/spaces/{space_id}/objects",
            payload=create_payload,
        )
        object_id = ((created.get("object") or {}).get("id")) or created.get("id")
        if not object_id:
            raise RuntimeError(f"建立 object 失敗，回應：{json.dumps(created, ensure_ascii=False)}")

        self._http_json(
            method="PATCH",
            path=f"/v1/spaces/{space_id}/objects/{object_id}",
            payload={
                "name": title,
                "markdown": markdown,
                "properties": properties,
            },
        )
        return str(object_id)

    def update_clip_object(
        self,
        *,
        space_id: str,
        object_id: str,
        title: str,
        markdown: str,
        properties: List[Dict[str, Any]],
        icon: Optional[Dict[str, str]] = None,
    ) -> None:
        payload: Dict[str, Any] = {
            "name": title,
            "markdown": markdown,
            "properties": properties,
        }
        if icon:
            payload["icon"] = icon
        self._http_json(
            method="PATCH",
            path=f"/v1/spaces/{space_id}/objects/{object_id}",
            payload=payload,
        )

    # --- Delegated: Object Finder ---

    def find_object_id_by_name(self, *, space_id: str, name: str) -> Optional[str]:
        return self._finder.find_object_id_by_name(space_id=space_id, name=name)

    def find_object_id_by_name_with_type(
        self,
        *,
        space_id: str,
        name: str,
        preferred_type_keys: Optional[List[str]] = None,
    ) -> Optional[str]:
        return self._finder.find_object_id_by_name_with_type(
            space_id=space_id, name=name, preferred_type_keys=preferred_type_keys,
        )

    def find_objects_by_source_url(
        self,
        *,
        space_id: str,
        source_url: str,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        return self._finder.find_objects_by_source_url(
            space_id=space_id, source_url=source_url, limit=limit,
        )

    # --- Delegated: Tag API ---

    def list_tags(self, *, space_id: str, property_id: str) -> List[Dict[str, Any]]:
        return self._tag_api.list_tags(space_id=space_id, property_id=property_id)

    def create_tag(
        self,
        *,
        space_id: str,
        property_id: str,
        name: str,
        color: str = "grey",
    ) -> Dict[str, Any]:
        return self._tag_api.create_tag(
            space_id=space_id, property_id=property_id, name=name, color=color,
        )

    def update_tag(
        self,
        *,
        space_id: str,
        property_id: str,
        tag_id: str,
        name: str,
        color: str,
    ) -> Dict[str, Any]:
        return self._tag_api.update_tag(
            space_id=space_id, property_id=property_id, tag_id=tag_id,
            name=name, color=color,
        )

    # --- Static helpers (kept for backward compat) ---

    @staticmethod
    def _extract_type_key(item: Dict[str, Any]) -> str:
        return AnytypeObjectFinder._extract_type_key(item)

    @staticmethod
    def _extract_source_url(properties: List[Dict[str, Any]]) -> str:
        return AnytypeObjectFinder._extract_source_url(properties)

    @staticmethod
    def _extract_updated_at(properties: List[Dict[str, Any]]) -> str:
        return AnytypeObjectFinder._extract_updated_at(properties)


/**
 * AnytypeApi - Anytype HTTP API 客戶端
 * 移植自 anytype_client.py
 * 直接與 Anytype 本地 API (port 31009) 通訊，不需要 Python 中間層
 */

const ANYTYPE_BASE_URL = "http://127.0.0.1:31009";
const ANYTYPE_API_VERSION = "2025-11-08";
const STORAGE_API_KEY = "anytypeApiKey";

const WEB_CLIP_PROPERTIES = [
  { key: "source_url", name: "Source URL", format: "url" },
  { key: "author", name: "Author", format: "text" },
  { key: "author_raw", name: "Author (raw text)", format: "text" },
  { key: "media", name: "Media", format: "text" },
  { key: "media_raw", name: "Media (raw text)", format: "text" },
  { key: "published_at", name: "Published At", format: "date" },
  { key: "captured_at", name: "Captured At", format: "date" },
  { key: "excerpt", name: "Excerpt", format: "text" },
  { key: "cover_image_url", name: "Cover Image URL", format: "url" },
  { key: "embedded_media_urls", name: "Embedded Media URLs", format: "text" },
  { key: "read_time_min", name: "Read Time (min)", format: "number" },
  { key: "clip_source", name: "Clip Source", format: "text" },
];

class AnytypeApi {
  constructor({ apiKey = "", baseUrl = ANYTYPE_BASE_URL, apiVersion = ANYTYPE_API_VERSION } = {}) {
    this.apiKey = String(apiKey || "").trim();
    this.baseUrl = String(baseUrl || ANYTYPE_BASE_URL).replace(/\/+$/, "");
    this.apiVersion = String(apiVersion || ANYTYPE_API_VERSION).trim();
  }

  _headers(extra = {}) {
    const h = {
      "Anytype-Version": this.apiVersion,
      ...extra,
    };
    if (this.apiKey) {
      h["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async _request(method, path, { payload, query } = {}) {
    let url = this.baseUrl + path;
    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) params.set(k, String(v));
      }
      url += "?" + params.toString();
    }

    const init = {
      method: method.toUpperCase(),
      headers: this._headers(),
    };

    if (payload !== undefined && payload !== null) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(payload);
    }

    const resp = await fetch(url, init);
    const text = await resp.text();
    const data = text.trim() ? JSON.parse(text) : {};

    if (!resp.ok) {
      const errMsg = (data && (data.error || data.message)) || `HTTP ${resp.status}`;
      throw new Error(`${method} ${path} failed (${resp.status}): ${errMsg}`);
    }
    return data;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  async requestChallenge() {
    const data = await this._request("POST", "/v1/auth/challenges", {
      payload: { app_name: "Anytype Web Clipper" },
    });
    const challengeId = String(data.challenge_id || data.challengeId || "").trim();
    if (!challengeId) throw new Error(t("error_no_challenge_id"));
    return { challenge_id: challengeId };
  }

  async solveChallenge(challengeId, code) {
    if (!challengeId || !code) throw new Error(t("error_challenge_empty"));
    const data = await this._request("POST", "/v1/auth/api_keys", {
      payload: { challenge_id: challengeId, code: String(code).trim() },
    });
    const apiKey = String(data.api_key || data.apiKey || "").trim();
    if (!apiKey) throw new Error(t("error_no_api_key"));
    return apiKey;
  }

  // ── Spaces ───────────────────────────────────────────────────────────────

  async listSpaces() {
    const data = await this._request("GET", "/v1/spaces");
    return data.data || [];
  }

  async resolveSpaceId(preferredSpaceId = "") {
    const id = String(preferredSpaceId || "").trim();
    if (id) return id;
    const spaces = await this.listSpaces();
    for (const s of spaces) {
      const sid = String(s.id || s.space_id || "").trim();
      if (sid) return sid;
    }
    throw new Error(t("error_no_space_id"));
  }

  // ── Properties ───────────────────────────────────────────────────────────

  async listProperties(spaceId) {
    let offset = 0;
    const limit = 100;
    const merged = {};
    while (true) {
      const data = await this._request("GET", `/v1/spaces/${spaceId}/properties`, {
        query: { offset, limit },
      });
      for (const item of (data.data || [])) {
        const key = item.key;
        if (key) merged[String(key)] = item;
      }
      const pagination = data.pagination || {};
      if (!pagination.has_more) break;
      const nextOffset = parseInt(pagination.offset ?? offset, 10) + parseInt(pagination.limit ?? limit, 10);
      if (nextOffset <= offset) break;
      offset = nextOffset;
    }
    return merged;
  }

  async getPropertyByKey(spaceId, key) {
    const props = await this.listProperties(spaceId);
    return props[key] || null;
  }

  async createProperty(spaceId, { key, name, format }) {
    return this._request("POST", `/v1/spaces/${spaceId}/properties`, {
      payload: { key, name, format },
    });
  }

  // ── Types ────────────────────────────────────────────────────────────────

  async listTypes(spaceId) {
    let offset = 0;
    const limit = 100;
    const merged = [];
    while (true) {
      const data = await this._request("GET", `/v1/spaces/${spaceId}/types`, {
        query: { offset, limit },
      });
      merged.push(...(data.data || []));
      const pagination = data.pagination || {};
      if (!pagination.has_more) break;
      const nextOffset = parseInt(pagination.offset ?? offset, 10) + parseInt(pagination.limit ?? limit, 10);
      if (nextOffset <= offset) break;
      offset = nextOffset;
    }
    return merged;
  }

  async createType(spaceId, { key, name, pluralName, layout, properties }) {
    return this._request("POST", `/v1/spaces/${spaceId}/types`, {
      payload: {
        key,
        name,
        plural_name: pluralName,
        layout: layout || "basic",
        properties: properties || [],
      },
    });
  }

  // ── Tags ─────────────────────────────────────────────────────────────────

  async listTags(spaceId, propertyId) {
    const data = await this._request("GET", `/v1/spaces/${spaceId}/properties/${propertyId}/tags`);
    return data.data || [];
  }

  async createTag(spaceId, propertyId, { name, color = "grey" }) {
    return this._request("POST", `/v1/spaces/${spaceId}/properties/${propertyId}/tags`, {
      payload: { name, color },
    });
  }

  async updateTag(spaceId, propertyId, tagId, { name, color }) {
    return this._request("PATCH", `/v1/spaces/${spaceId}/properties/${propertyId}/tags/${tagId}`, {
      payload: { name, color },
    });
  }

  // ── Objects ───────────────────────────────────────────────────────────────

  async searchObjects(spaceId, { query, limit = 20 }) {
    const q = String(query || "").trim();
    if (!q) return [];
    const data = await this._request("POST", `/v1/spaces/${spaceId}/search`, {
      payload: { query: q, limit: Math.max(1, Math.min(parseInt(limit, 10), 100)) },
    });
    return data.data || [];
  }

  async listObjects(spaceId, { limit = 100 } = {}) {
    const data = await this._request("GET", `/v1/spaces/${spaceId}/objects`, {
      query: { offset: 0, limit: Math.max(1, Math.min(parseInt(limit, 10), 200)) },
    });
    return data.data || [];
  }

  async getObject(spaceId, objectId, format = "markdown") {
    const data = await this._request("GET", `/v1/spaces/${spaceId}/objects/${objectId}`, {
      query: { format },
    });
    return data.object || {};
  }

  async createObject(spaceId, { typeKey, name, properties = [], icon = null }) {
    const payload = { type_key: typeKey, name };
    if (properties.length > 0) payload.properties = properties;
    if (icon) payload.icon = icon;
    const created = await this._request("POST", `/v1/spaces/${spaceId}/objects`, { payload });
    const objectId = ((created.object || {}).id) || created.id;
    if (!objectId) throw new Error(t("error_create_object_failed", JSON.stringify(created)));
    return String(objectId);
  }

  async createClipObject(spaceId, { title, markdown, properties, typeKey, icon = null }) {
    const objectId = await this.createObject(spaceId, {
      typeKey: typeKey || "web_clip",
      name: title,
      properties,
      icon,
    });
    await this._request("PATCH", `/v1/spaces/${spaceId}/objects/${objectId}`, {
      payload: { name: title, markdown, properties },
    });
    return objectId;
  }

  async updateClipObject(spaceId, objectId, { title, markdown, properties, icon = null }) {
    const payload = { name: title, markdown, properties };
    if (icon) payload.icon = icon;
    await this._request("PATCH", `/v1/spaces/${spaceId}/objects/${objectId}`, { payload });
  }

  async findObjectsBySourceUrl(spaceId, sourceUrl, limit = 20) {
    const normalized = String(sourceUrl || "").trim();
    if (!normalized) return [];

    let hits = await this.searchObjects(spaceId, { query: normalized, limit });
    if (!hits.length) {
      hits = await this.listObjects(spaceId, { limit: Math.min(Math.max(limit * 10, 120), 400) });
    }

    const matches = [];
    for (const hit of hits) {
      const objectId = String(hit.id || "").trim();
      if (!objectId) continue;
      let full;
      try {
        full = await this.getObject(spaceId, objectId);
      } catch (_e) {
        continue;
      }
      const props = full.properties || [];
      const actualUrl = this._extractSourceUrl(props);
      if (actualUrl !== normalized) continue;
      const typeInfo = full.type || {};
      matches.push({
        object_id: objectId,
        name: String(full.name || hit.name || objectId).trim(),
        updated_at: this._extractUpdatedAt(props),
        type_key: String(typeInfo.key || "").trim(),
      });
    }
    matches.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    return matches;
  }

  _extractSourceUrl(properties) {
    for (const item of (properties || [])) {
      const key = String(item.key || "").trim();
      if (key !== "source_url" && key !== "source") continue;
      const value = String(item.url || "").trim();
      if (value) return value;
    }
    return "";
  }

  _extractUpdatedAt(properties) {
    const candidates = ["last_modified_date", "last_modified", "captured_at", "created_date"];
    for (const key of candidates) {
      for (const item of (properties || [])) {
        if (String(item.key || "").trim() !== key) continue;
        const value = String(item.date || "").trim();
        if (value) return value;
      }
    }
    return "";
  }

  // ── Ensure Web Clip Type ──────────────────────────────────────────────────

  async ensureWebClipType(spaceId, typeKey = "web_clip", typeName = "Web Clip") {
    const existingProps = await this.listProperties(spaceId);
    for (const spec of WEB_CLIP_PROPERTIES) {
      if (spec.key in existingProps) continue;
      try {
        await this.createProperty(spaceId, { key: spec.key, name: spec.name, format: spec.format });
      } catch (e) {
        if (!String(e.message || "").includes("already exists")) throw e;
      }
    }

    const existingTypes = await this.listTypes(spaceId);
    if (existingTypes.some((t) => t.key === typeKey)) return;

    try {
      await this.createType(spaceId, {
        key: typeKey,
        name: typeName,
        pluralName: typeName + "s",
        layout: "basic",
        properties: WEB_CLIP_PROPERTIES,
      });
    } catch (e) {
      if (!String(e.message || "").includes("already exists")) throw e;
    }
  }

  // ── Storage helpers ───────────────────────────────────────────────────────

  static async loadApiKey() {
    if (!(globalThis.chrome && chrome.storage && chrome.storage.local)) return "";
    const stored = await chrome.storage.local.get([STORAGE_API_KEY]);
    return String(stored[STORAGE_API_KEY] || "").trim();
  }

  static async saveApiKey(apiKey) {
    if (!(globalThis.chrome && chrome.storage && chrome.storage.local)) return;
    await chrome.storage.local.set({ [STORAGE_API_KEY]: apiKey });
  }

  static async clearApiKey() {
    if (!(globalThis.chrome && chrome.storage && chrome.storage.local)) return;
    await chrome.storage.local.remove([STORAGE_API_KEY]);
  }
}

// Node.js test support
if (typeof module !== "undefined") module.exports = { AnytypeApi };

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Dict

import yaml


DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent / "config" / "defaults.yaml"


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    merged = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config(config_path: str | None = None) -> Dict[str, Any]:
    base = yaml.safe_load(DEFAULT_CONFIG_PATH.read_text(encoding="utf-8")) or {}
    if not config_path:
        return base

    user_path = Path(config_path).expanduser().resolve()
    if not user_path.exists():
        raise FileNotFoundError(f"設定檔不存在：{user_path}")

    user_cfg = yaml.safe_load(user_path.read_text(encoding="utf-8")) or {}
    if not isinstance(user_cfg, dict):
        raise ValueError(f"設定檔格式錯誤：{user_path}")

    return _deep_merge(base, user_cfg)


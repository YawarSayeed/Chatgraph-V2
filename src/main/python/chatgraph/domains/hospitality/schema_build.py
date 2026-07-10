"""Install the supplied hospitality GraphSchema JSON artifact.

The hospitality schema was supplied as JSON, so this build step validates that
the committed artifact exists and has the expected top-level GraphSchema shape.
"""

from __future__ import annotations

import json
from pathlib import Path


def _schema_path() -> Path:
    return Path(__file__).resolve().parents[4] / "json" / "hospitality.json"


def main() -> int:
    path = _schema_path()
    with path.open("r", encoding="utf-8-sig") as f:
        data = json.load(f)
    if not isinstance(data.get("vertices"), list) or not isinstance(data.get("edges"), list):
        raise ValueError(f"{path} is not a GraphSchema JSON artifact")
    print(f"{path} already exists ({len(data['vertices'])} vertices, {len(data['edges'])} edges)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

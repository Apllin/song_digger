"""Dump the FastAPI OpenAPI spec to ./openapi.json (repo root of python-service).

Run via the package script: `pnpm dump:openapi`.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.main import app  # noqa: E402

target = ROOT / "openapi.json"
target.write_text(json.dumps(app.openapi(), indent=2) + "\n")
print(f"wrote {target.relative_to(ROOT)}")

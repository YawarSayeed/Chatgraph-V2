"""Resolve and prepend ``$HYDRAPOP_HOME/src/main/python`` to ``sys.path``.

chatgraph depends on HydraPop as a source-level dependency rather than a
pip-installed package. The underlying Hydra runtime (``hydra-kernel``,
``hydra-pg``) is available on PyPI and is declared as a normal
``pyproject.toml`` dependency; HydraPop itself, however, is not yet
published to any package index and must be supplied as a local clone.
The caller is expected to set ``HYDRAPOP_HOME`` to the path of that
clone (https://github.com/CategoricalData/HydraPop).

Import this module before any ``import hydrapop.*`` statements. It is
idempotent: subsequent imports observe that the path entry is already
present and do nothing.
"""

import os
import sys
from pathlib import Path


def hydrapop_python_path() -> Path:
    home = os.environ.get("HYDRAPOP_HOME")
    if not home:
        raise RuntimeError(
            "HYDRAPOP_HOME is not set. Point it at a local clone of "
            "https://github.com/CategoricalData/HydraPop, e.g.:\n"
            "    export HYDRAPOP_HOME=/path/to/HydraPop"
        )
    p = Path(home) / "src" / "main" / "python"
    if not p.is_dir():
        raise RuntimeError(
            f"HYDRAPOP_HOME={home} does not contain src/main/python/. "
            "Check the path."
        )
    return p


def ensure_on_path() -> None:
    p = str(hydrapop_python_path())
    if p not in sys.path:
        sys.path.insert(0, p)


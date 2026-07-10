"""chatgraph: voice-driven knowledge-elicitation demo.

Importing this package prepends ``$HYDRAPOP_HOME/src/main/python`` to
``sys.path`` so that ``hydrapop.*`` and (transitively) ``hydra.*`` modules
become importable.
"""

from ._hydrapop_bootstrap import ensure_on_path as _ensure

_ensure()

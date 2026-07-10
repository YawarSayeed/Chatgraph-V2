"""CLI dispatcher for ``chatgraph-build-schema``.

Usage::

    chatgraph-build-schema medical            # build one domain
    chatgraph-build-schema                    # build all registered domains

Each domain's schema is authored by its own ``schema_build`` module
under ``chatgraph.domains.<name>``. This dispatcher just routes to the
right one based on the CLI argument.
"""

from __future__ import annotations

import argparse
import importlib
import sys

from chatgraph import domains as _domains_pkg


def _build_one(name: str) -> int:
    """Build the schema for a single domain by importing its
    ``schema_build`` module and calling its ``main()``."""
    try:
        _domains_pkg.get(name)  # validate registered
    except KeyError as e:
        print(str(e), file=sys.stderr)
        return 1
    module = importlib.import_module(f"chatgraph.domains.{name}.schema_build")
    rc = module.main()
    return rc if isinstance(rc, int) else 0


def main() -> int:
    available = _domains_pkg.available()
    parser = argparse.ArgumentParser(
        prog="chatgraph-build-schema",
        description=(
            "Build the committed schema JSON for one or all chatgraph "
            "domains."
        ),
    )
    parser.add_argument(
        "domain",
        nargs="?",
        choices=available,
        help=(
            "Which domain to build. Omit to build every registered "
            "domain. Available: " + ", ".join(available)
        ),
    )
    args = parser.parse_args()

    if args.domain is None:
        rc = 0
        for name in available:
            print(f"--- {name} ---")
            r = _build_one(name)
            if r != 0:
                rc = r
        return rc

    return _build_one(args.domain)


if __name__ == "__main__":
    sys.exit(main())

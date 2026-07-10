"""Async wrapper around hydrapop.gremlin_bridge.hydra_to_gremlin.

Owns the gremlinpython DriverRemoteConnection and exposes an async
``write(graph)`` that runs the synchronous Gremlin writes on a worker
thread. This is required because gremlinpython spins up its own asyncio
event loop internally for the WebSocket transport, which deadlocks when
called from within another running loop.

The writer is optional: if the Gremlin Server isn't reachable at startup,
``GremlinWriter.connect()`` returns ``None`` and the orchestrator runs
without graph writes (the conversation still works, the transcript still
records).
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

log = logging.getLogger(__name__)

if TYPE_CHECKING:
    import hydra.pg.model as pg


DEFAULT_URL = "ws://localhost:8182/gremlin"
DEFAULT_TRAVERSAL_SOURCE = "g"


class GremlinWriter:
    """Async writer for a live Gremlin Server.

    Use ``async with GremlinWriter() as w:`` to scope the connection.
    Call ``w.submit(graph)`` from anywhere; deltas are written in submit
    order by a single background worker so concurrent producers (e.g.
    fire-and-forget extraction tasks) can't race their edges past each
    other's vertices.

    ``await w.write(graph)`` is also available for callers that want to
    block until a specific delta is written.
    """

    def __init__(
        self,
        url: str = DEFAULT_URL,
        traversal_source: str = DEFAULT_TRAVERSAL_SOURCE,
    ) -> None:
        self._url = url
        self._traversal_source = traversal_source
        self._conn = None
        self._g = None
        self._queue: asyncio.Queue = asyncio.Queue()
        self._worker: asyncio.Task | None = None

    async def __aenter__(self) -> "GremlinWriter":
        await self._connect()
        if self._g is not None:
            self._worker = asyncio.create_task(self._drain())
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._worker is not None:
            await self._queue.put(None)
            try:
                await self._worker
            except asyncio.CancelledError:
                pass
            self._worker = None
        await self._close()

    async def _connect(self) -> None:
        from gremlin_python.driver.driver_remote_connection import (
            DriverRemoteConnection,
        )
        from gremlin_python.process.anonymous_traversal import traversal

        loop = asyncio.get_running_loop()

        def _do_connect():
            conn = DriverRemoteConnection(self._url, self._traversal_source)
            g = traversal().with_remote(conn)
            # Touch the server so a failure surfaces here, not on the
            # first write.
            g.V().limit(1).to_list()
            return conn, g

        try:
            self._conn, self._g = await loop.run_in_executor(None, _do_connect)
            log.info("GremlinWriter: connected to %s", self._url)
        except Exception:
            log.warning(
                "GremlinWriter: could not connect to %s; graph writes "
                "will be skipped this session",
                self._url,
                exc_info=False,
            )
            self._conn = None
            self._g = None

    async def _close(self) -> None:
        if self._conn is None:
            return
        loop = asyncio.get_running_loop()
        conn = self._conn
        self._conn = None
        self._g = None
        try:
            await loop.run_in_executor(None, conn.close)
        except Exception:
            log.debug("GremlinWriter: close raised", exc_info=True)

    @property
    def connected(self) -> bool:
        return self._g is not None

    async def load_graph(self):
        """Read the entire current graph back as a hydra.pg.model.Graph.

        Returns ``None`` when not connected. Runs on a worker thread.
        """
        if self._g is None:
            return None
        from hydrapop.gremlin_bridge import gremlin_to_hydra

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, lambda: gremlin_to_hydra(self._g))

    async def drop_all(self) -> None:
        """Delete every vertex and edge in the live graph.

        No-op when not connected. Runs on a worker thread.
        """
        if self._g is None:
            return
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: self._g.V().drop().iterate())
        log.info("GremlinWriter: dropped all vertices and edges")

    def submit(self, graph: "pg.Graph") -> None:
        """Enqueue a Hydra graph delta for writing in submit order.

        Returns immediately; the actual write happens on the writer's
        background task. Fire-and-forget producers should call this
        instead of ``write`` so their deltas can't race.
        """
        if self._g is None:
            return
        if not graph.vertices and not graph.edges:
            return
        self._queue.put_nowait(graph)

    async def write(self, graph: "pg.Graph") -> None:
        """Write a Hydra graph delta synchronously (blocking) and wait
        until all previously submitted deltas have drained.

        Useful for callers that want a definite happens-before with
        respect to prior writes. Most code paths should use ``submit``.
        """
        if self._g is None:
            return
        if not graph.vertices and not graph.edges:
            return
        done: asyncio.Future = asyncio.get_running_loop().create_future()
        self._queue.put_nowait((graph, done))
        await done

    async def _drain(self) -> None:
        """Worker loop: pop deltas off the queue and write them in order."""
        from hydrapop.gremlin_bridge import hydra_to_gremlin

        loop = asyncio.get_running_loop()
        while True:
            item = await self._queue.get()
            if item is None:
                return
            done_future = None
            if isinstance(item, tuple):
                graph, done_future = item
            else:
                graph = item

            def _do_write(g=graph):
                hydra_to_gremlin(g, self._g)

            try:
                await loop.run_in_executor(None, _do_write)
                if done_future is not None and not done_future.done():
                    done_future.set_result(None)
            except Exception as e:
                log.exception("GremlinWriter: write failed (continuing)")
                if done_future is not None and not done_future.done():
                    done_future.set_exception(e)

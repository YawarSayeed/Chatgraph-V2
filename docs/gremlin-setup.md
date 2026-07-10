# Gremlin Server config for chatgraph

Use these configs with a local Apache TinkerPop Gremlin Server install
(version 3.7.3 tested). Download the server tarball from
[tinkerpop.apache.org/downloads](https://tinkerpop.apache.org/downloads.html),
unpack it, and point `GREMLIN_SERVER_HOME` at the unpacked directory.
This is just a convenience variable used by the steps below to locate
the install; the TinkerPop launch script derives its own home from the
location of `gremlin-server.sh`, so you do not need to export anything
the script itself reads.

## Files

- `chatgraph-gremlin-server.yaml` — main server config. Binds to
  `ws://localhost:8182/gremlin`. Empty TinkerGraph; GraphSON 3 and
  GraphBinary serializers.
- `chatgraph-tinkergraph.properties` — graph config. Uses
  `vertexIdManager=ANY` so the schema's string ids are accepted.
- `chatgraph-init.groovy` — server init script. Registers a global
  traversal source `g` over the configured `graph` so remote clients
  can `traversal().with_remote(connection)` without further setup.

## Install the configs

Gremlin Server resolves YAML-internal paths relative to its working
directory at launch (the install root, which the launch script derives
from its own location), matching how the stock
`gremlin-server-modern.yaml` references `conf/tinkergraph-empty.properties`.
So before launching, copy all three files from `config/gremlin/` (at
the repo root) into `$GREMLIN_SERVER_HOME/conf/`:

```bash
export GREMLIN_SERVER_HOME=/path/to/apache-tinkerpop-gremlin-server-3.7.3
cp config/gremlin/chatgraph-gremlin-server.yaml \
   config/gremlin/chatgraph-tinkergraph.properties \
   config/gremlin/chatgraph-init.groovy \
   "$GREMLIN_SERVER_HOME/conf/"
```

If you later edit any of these in the repo, re-`cp` to pick up the
change.

## Start the server

```bash
"$GREMLIN_SERVER_HOME/bin/gremlin-server.sh" "$GREMLIN_SERVER_HOME/conf/chatgraph-gremlin-server.yaml"
```

Leave it running in its own terminal. The server log prints
"Channel started at port 8182" when it's ready.

## Stop the server

`Ctrl-C` in its terminal.

## Connect from gdotv

In gdotv, "Add Connection" → Apache TinkerPop / Gremlin Server →
`ws://localhost:8182/gremlin`. Click "Refresh graph" to repaint as the
conversation populates it.

## Smoke test the connection

```bash
cd /path/to/chatgraph
source .venv/bin/activate
python -c "
from gremlin_python.driver.driver_remote_connection import DriverRemoteConnection
from gremlin_python.process.anonymous_traversal import traversal
conn = DriverRemoteConnection('ws://localhost:8182/gremlin', 'g')
g = traversal().with_remote(conn)
print('vertex count:', g.V().count().next())
conn.close()
"
```

Should print `vertex count: 0` (an empty graph).

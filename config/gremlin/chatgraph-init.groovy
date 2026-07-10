// Init script for chatgraph's Gremlin Server config.
//
// Registers a global traversal source `g` over the configured `graph`
// so that remote clients (gremlinpython, gdotv) can use:
//     traversal().with_remote(connection)
// without explicitly creating one.

def globals = [:]

globals << [g : traversal().withEmbedded(graph)]

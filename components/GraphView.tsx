"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3Force from "d3-force";
import { keyText } from "@/lib/gate/gate";
import type { GraphDisplayConfig } from "@/lib/domains";
import type { GraphState, GraphVertex } from "@/lib/types";

type Pos = { x: number; y: number };

type LayoutNode = {
  id: string;
  label: string;
  x: number;
  y: number;
};

type LayoutEdge = {
  source: string;
  target: string;
  label: string;
};

function semanticLabel(vertex: GraphVertex, display?: GraphDisplayConfig): string {
  const { label, properties: p } = vertex;
  if (display?.labelOverrides?.[label]) return display.labelOverrides[label];
  const v = p.value;
  if (typeof v === "string" && v.length > 0) return v;
  // The same naming priority the gate uses for resolution, so a DecisionRule
  // shows its ruleText instead of the bare word "DecisionRule".
  const key = keyText(p);
  if (key) return key;
  const duration = p.duration;
  if (typeof duration === "string" && duration.length > 0) return duration;
  if (label === "Frequency") {
    const count = typeof p.count === "number" ? p.count : undefined;
    const per = typeof p.per === "string" ? p.per : "";
    if (count !== undefined && per) return `${count} / ${per}`;
    if (count !== undefined) return String(count);
  }
  if (label === "PainCharacter") {
    const note = p.note;
    if (typeof note === "string" && note.length > 0) return note;
    const trueFlags = Object.entries(p)
      .filter(([, value]) => value === true)
      .map(([key]) => key.replace(/([A-Z])/g, " $1").toLowerCase());
    if (trueFlags.length > 0) return trueFlags.join(", ");
  }
  if (typeof v === "number") return String(v);
  if (label === "Headache" && typeof p.description === "string") return p.description;
  if (label === "FamilyHistory") {
    const parts = [p.relation, p.condition].filter((x): x is string => typeof x === "string");
    return parts.length ? parts.join(": ") : "Family History";
  }
  if (label === "Comorbidity" && typeof p.condition === "string") return p.condition;
  if (label === "Concept" && typeof p.label === "string") return p.label;
  if (label === "Comment" && typeof p.description === "string")
    return p.description.length > 28 ? p.description.slice(0, 27) + "\u2026" : p.description;
  if (label === "Diagnosis" && typeof p.value === "string") return p.value;
  return label;
}

function radius(label: string, display?: GraphDisplayConfig): number {
  if (display?.radii?.[label]) return display.radii[label];
  if (label === "Person") return 18;
  if (label === "Headache") return 16;
  if (["Comment", "Concept", "HeadacheClassification", "Diagnosis", "PainCharacter"].includes(label)) return 14;
  return 12;
}

function color(label: string, display?: GraphDisplayConfig): string {
  if (display?.colors?.[label]) return display.colors[label];
  if (label === "Person") return "#0f766e";
  if (label === "Headache") return "#b2462e";
  if (label === "HeadacheClassification") return "#e6a817";
  if (label === "Comment" || label === "Concept") return "#7c3aed";
  return "#6b5ce7";
}

const W = 720;
const H = 520;

/**
 * Incremental force layout. Nodes the previous layout already placed keep their
 * positions as the starting state; new nodes are seeded beside a neighbor they
 * connect to (or near the centre when unconnected). When most of the graph is
 * unchanged the simulation is warm-started at low alpha, so adding a turn's facts
 * adjusts the picture instead of reshuffling it — the per-turn reshuffle was the
 * single biggest reason the graph read as messy.
 */
function computeLayout(
  vertices: GraphVertex[],
  edges: { out: string; in: string; label: string }[],
  display: GraphDisplayConfig | undefined,
  previous: Map<string, Pos>
): { nodes: LayoutNode[]; edges: LayoutEdge[] } | null {
  if (vertices.length === 0) return null;

  const neighborSeed = (id: string): Pos | null => {
    for (const e of edges) {
      const other = e.out === id ? e.in : e.in === id ? e.out : null;
      if (!other) continue;
      const anchor = previous.get(other);
      if (anchor) return anchor;
    }
    return null;
  };

  let placed = 0;
  const simNodes: (LayoutNode & { vx: number; vy: number })[] = vertices.map((v) => {
    const kept = previous.get(v.id);
    if (kept) {
      placed += 1;
      return { id: v.id, label: v.label, x: kept.x, y: kept.y, vx: 0, vy: 0 };
    }
    const seed = neighborSeed(v.id);
    const jitter = () => (Math.random() - 0.5) * 60;
    return {
      id: v.id,
      label: v.label,
      x: (seed?.x ?? W / 2) + jitter(),
      y: (seed?.y ?? H / 2) + jitter(),
      vx: 0,
      vy: 0,
    };
  });

  const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
  const simEdges: { source: LayoutNode & { vx: number; vy: number }; target: LayoutNode & { vx: number; vy: number }; label: string }[] = [];
  for (const e of edges) {
    const src = nodeMap.get(e.out);
    const tgt = nodeMap.get(e.in);
    if (src && tgt) simEdges.push({ source: src, target: tgt, label: e.label });
  }

  // Charge scales with node count so dense graphs spread instead of clumping;
  // the collision radius reserves room for the label pill under each node.
  const chargeStrength = -Math.min(600, 180 + simNodes.length * 6);
  const mostlyStable = simNodes.length > 0 && placed / simNodes.length > 0.7;

  const sim = d3Force
    .forceSimulation(simNodes)
    .force("link", d3Force.forceLink(simEdges).distance(95).strength(0.2))
    .force("charge", d3Force.forceManyBody().strength(chargeStrength))
    .force("center", d3Force.forceCenter(W / 2, H / 2))
    .force("collision", d3Force.forceCollide().radius((n) => radius((n as LayoutNode).label, display) + 22))
    .alphaDecay(0.04)
    .velocityDecay(0.5)
    .stop();

  sim.alpha(mostlyStable ? 0.25 : 1);
  const totalTicks = Math.ceil(Math.log(0.001 / (mostlyStable ? 0.25 : 1)) / Math.log(1 - 0.04));
  for (let i = 0; i < Math.max(totalTicks, 30); i += 1) sim.tick();

  return {
    nodes: simNodes.map((n) => ({ id: n.id, label: n.label, x: n.x, y: n.y })),
    edges: simEdges.map((e) => ({
      source: e.source.id,
      target: e.target.id,
      label: e.label,
    })),
  };
}

export function GraphView({ graph, display }: { graph: GraphState; display?: GraphDisplayConfig }) {
  const hiddenLabels = useMemo(() => new Set(display?.hiddenLabels ?? []), [display]);
  const hiddenEdges = useMemo(() => new Set(display?.hiddenEdges ?? []), [display]);
  const hiddenTextPatterns = useMemo(
    () => (display?.hiddenTextPatterns ?? []).map((pattern) => new RegExp(pattern, "i")),
    [display]
  );
  // A superseded fact is history, not current knowledge: the view shows the
  // graph as it stands now, and the superseded version stays in the data for audit.
  const supersededIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edgeItem of Object.values(graph.edges)) {
      if (edgeItem.label === "supersededBy") ids.add(edgeItem.out);
    }
    return ids;
  }, [graph.edges]);
  const vertexList = useMemo(
    () =>
      Object.values(graph.vertices).filter(
        (vertex) =>
          !hiddenLabels.has(vertex.label) &&
          !supersededIds.has(vertex.id) &&
          !hiddenTextPatterns.some((pattern) => pattern.test(semanticLabel(vertex, display)))
      ),
    [display, graph.vertices, hiddenLabels, hiddenTextPatterns, supersededIds]
  );
  const visibleIds = useMemo(() => new Set(vertexList.map((vertex) => vertex.id)), [vertexList]);
  const edgeList = useMemo(
    () =>
      Object.values(graph.edges).filter(
        (edgeItem) =>
          !hiddenEdges.has(edgeItem.label) &&
          edgeItem.label !== "supersededBy" &&
          visibleIds.has(edgeItem.out) &&
          visibleIds.has(edgeItem.in)
      ),
    [graph.edges, hiddenEdges, visibleIds]
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomGroupRef = useRef<SVGGElement>(null);
  const [layout, setLayout] = useState<{ nodes: LayoutNode[]; edges: LayoutEdge[] } | null>(null);
  const [nodePositions, setNodePositions] = useState<Map<string, Pos>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Recompute layout when the graph changes, warm-starting from wherever the
  // nodes currently are — including positions the user dragged them to.
  const positionsRef = useRef<Map<string, Pos>>(new Map());
  useEffect(() => {
    positionsRef.current = nodePositions.size > 0 ? nodePositions : positionsRef.current;
  }, [nodePositions]);
  useEffect(() => {
    const result = computeLayout(vertexList, edgeList, display, positionsRef.current);
    if (result) {
      setLayout(result);
      const pos = new Map<string, Pos>();
      for (const n of result.nodes) pos.set(n.id, { x: n.x, y: n.y });
      setNodePositions(pos);
      positionsRef.current = pos;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // The viewport survives re-layouts: it lives in a ref, not in the effect.
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const userAdjustedViewRef = useRef(false);

  // Until the user pans or zooms themselves, keep the whole graph in view.
  useEffect(() => {
    if (!layout || userAdjustedViewRef.current) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of layout.nodes) {
      const pos = nodePositions.get(n.id) ?? { x: n.x, y: n.y };
      minX = Math.min(minX, pos.x); maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y); maxY = Math.max(maxY, pos.y);
    }
    if (!Number.isFinite(minX)) return;
    const pad = 60;
    const width = maxX - minX + pad * 2;
    const height = maxY - minY + pad * 2;
    const k = Math.min(1.4, Math.min(W / width, H / height));
    transformRef.current = {
      k,
      x: (W - k * (minX + maxX)) / 2,
      y: (H - k * (minY + maxY)) / 2
    };
    zoomGroupRef.current?.setAttribute(
      "transform",
      `translate(${transformRef.current.x}, ${transformRef.current.y}) scale(${transformRef.current.k})`
    );
  }, [layout, nodePositions]);

  // Setup zoom + drag
  useEffect(() => {
    const svg = svgRef.current;
    const zoomGroup = zoomGroupRef.current;
    if (!svg || !zoomGroup || !layout) return;
    const zg = zoomGroup;
    const currentTransform = transformRef.current;

    function applyTransform() {
      zg.setAttribute(
        "transform",
        `translate(${currentTransform.x}, ${currentTransform.y}) scale(${currentTransform.k})`
      );
    }
    applyTransform();

    let isPanning = false;
    let isDragging = false;
    let dragNodeId: string | null = null;
    let pressX = 0;
    let pressY = 0;
    let moved = false;
    let panStartX = 0;
    let panStartY = 0;
    let dragStartX = 0;
    let dragStartY = 0;
    let nodeOrigX = 0;
    let nodeOrigY = 0;

    function svgPoint(e: MouseEvent): Pos {
      const pt = svg!.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = zg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const inv = ctm.inverse();
      return { x: pt.matrixTransform(inv).x, y: pt.matrixTransform(inv).y };
    }

    function hitTest(e: MouseEvent): string | null {
      const pt = svgPoint(e);
      for (const n of layout!.nodes) {
        const pos = nodePositions.get(n.id) ?? { x: n.x, y: n.y };
        const dx = pt.x - pos.x;
        const dy = pt.y - pos.y;
        if (dx * dx + dy * dy < (radius(n.label, display) + 10) ** 2) return n.id;
      }
      return null;
    }

    svg.style.cursor = "grab";

    svg.onmousedown = (e: MouseEvent) => {
      pressX = e.clientX;
      pressY = e.clientY;
      moved = false;
      const hit = hitTest(e);
      if (hit) {
        isDragging = true;
        dragNodeId = hit;
        const pos = nodePositions.get(hit) ?? { x: 0, y: 0 };
        nodeOrigX = pos.x;
        nodeOrigY = pos.y;
        const pt = svgPoint(e);
        dragStartX = pt.x;
        dragStartY = pt.y;
        svg.style.cursor = "grabbing";
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      isPanning = true;
      userAdjustedViewRef.current = true;
      panStartX = e.clientX - currentTransform.x;
      panStartY = e.clientY - currentTransform.y;
      svg.style.cursor = "grabbing";
    };

    const onMouseMove = (e: MouseEvent) => {
      if (Math.abs(e.clientX - pressX) + Math.abs(e.clientY - pressY) > 4) moved = true;
      if (isDragging && dragNodeId) {
        const pt = svgPoint(e);
        setNodePositions((prev) => {
          const next = new Map(prev);
          next.set(dragNodeId!, {
            x: nodeOrigX + pt.x - dragStartX,
            y: nodeOrigY + pt.y - dragStartY,
          });
          return next;
        });
        return;
      }
      if (isPanning) {
        currentTransform.x = e.clientX - panStartX;
        currentTransform.y = e.clientY - panStartY;
        applyTransform();
      }
    };

    const onMouseUp = () => {
      // A press that never travelled is a click: select the node (or clear).
      if (!moved) setSelectedId(dragNodeId);
      if (isDragging || isPanning) svg.style.cursor = "grab";
      isDragging = false;
      isPanning = false;
      dragNodeId = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userAdjustedViewRef.current = true;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newK = Math.max(0.1, Math.min(4, currentTransform.k * delta));
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      currentTransform.x = mx - (mx - currentTransform.x) * (newK / currentTransform.k);
      currentTransform.y = my - (my - currentTransform.y) * (newK / currentTransform.k);
      currentTransform.k = newK;
      applyTransform();
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    svg.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      svg.style.cursor = "";
      svg.onmousedown = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      svg.removeEventListener("wheel", onWheel);
    };
  }, [display, layout, nodePositions]);

  const labelMap = useMemo(
    () => new Map(vertexList.map((v) => [v.id, semanticLabel(v, display)])),
    [display, vertexList]
  );

  // Build a node position lookup for rendering
  const posMap = useMemo(() => {
    const m = new Map<string, Pos>();
    for (const n of layout?.nodes ?? []) {
      m.set(n.id, nodePositions.get(n.id) ?? { x: n.x, y: n.y });
    }
    return m;
  }, [layout, nodePositions]);

  const selected = selectedId ? graph.vertices[selectedId] : null;
  const selectedEvidence = useMemo(() => {
    if (!selected) return null;
    for (const edgeItem of Object.values(graph.edges)) {
      if (edgeItem.out !== selected.id) continue;
      const target = graph.vertices[edgeItem.in];
      if (target?.label === "ProvenanceEvidence") {
        return {
          traceText: String(target.properties.traceText ?? ""),
          confidence: typeof target.properties.confidence === "string" ? target.properties.confidence : null
        };
      }
    }
    return null;
  }, [graph, selected]);
  const selectedRelations = useMemo(() => {
    if (!selected) return [];
    const relations: { text: string; trace: string | null }[] = [];
    for (const edgeItem of Object.values(graph.edges)) {
      if (edgeItem.out !== selected.id && edgeItem.in !== selected.id) continue;
      const otherId = edgeItem.out === selected.id ? edgeItem.in : edgeItem.out;
      const other = graph.vertices[otherId];
      if (!other || other.label === "ProvenanceEvidence" || other.label === "TranscriptEpisode" || other.label === "SessionSection") continue;
      const arrow = edgeItem.out === selected.id ? `→ ${edgeItem.label}` : `← ${edgeItem.label}`;
      relations.push({
        text: `${arrow} ${semanticLabel(other, display)}`,
        trace: typeof edgeItem.properties?.traceText === "string" ? edgeItem.properties.traceText : null
      });
    }
    return relations.slice(0, 8);
  }, [display, graph, selected]);

  return (
    <div className="graph-shell">
      <div className="graph-topline">
        <span>{vertexList.length} vertices</span>
        <span>{edgeList.length} edges</span>
        {selected && <span style={{ marginLeft: "auto", opacity: 0.7 }}>selected: {semanticLabel(selected, display)}</span>}
      </div>
      <div className="graph-canvas">
        <svg
          ref={svgRef}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          style={{ display: "block", width: "100%", height: "100%", overflow: "visible" }}
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 7" refX={18} refY={3.5} markerWidth={7} markerHeight={6} orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#bbb" />
            </marker>
          </defs>

          <g ref={zoomGroupRef}>
            {layout?.edges.map((edge, i) => {
              const srcPos = posMap.get(edge.source);
              const tgtPos = posMap.get(edge.target);
              if (!srcPos || !tgtPos) return null;

              const srcLabel = layout.nodes.find((n) => n.id === edge.source)?.label ?? "";
              const tgtLabel = layout.nodes.find((n) => n.id === edge.target)?.label ?? "";

              const dx = tgtPos.x - srcPos.x;
              const dy = tgtPos.y - srcPos.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              if (len === 0) return null;
              const ux = dx / len;
              const uy = dy / len;
              const sr = radius(srcLabel, display);
              const tr = radius(tgtLabel, display);
              const x1 = srcPos.x + ux * sr;
              const y1 = srcPos.y + uy * sr;
              const x2 = tgtPos.x - ux * tr;
              const y2 = tgtPos.y - uy * tr;

              return (
                <g key={`e${i}`}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#c5bfb3" strokeWidth={1.3} markerEnd="url(#arrow)" />
                  {len > 90 && (
                    <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} textAnchor="middle" fontSize={8} fill="#888">
                      <tspan stroke="white" strokeWidth={3}>{edge.label}</tspan>
                      <tspan>{edge.label}</tspan>
                    </text>
                  )}
                </g>
              );
            })}

            {layout?.nodes.map((node) => {
              const pos = posMap.get(node.id) ?? { x: node.x, y: node.y };
              const r = radius(node.label, display);
              const lbl = labelMap.get(node.id) ?? node.label;
              const short = lbl.length > 24 ? lbl.slice(0, 23) + "\u2026" : lbl;
              const c = color(node.label, display);

              return (
                <g key={node.id} style={{ cursor: "pointer" }}>
                  <circle cx={pos.x} cy={pos.y} r={r} fill={c} stroke={c} strokeOpacity={0.25} strokeWidth={5} />
                  <circle cx={pos.x} cy={pos.y} r={r - 1} fill={c} stroke={c} strokeWidth={1.5} />
                  <foreignObject x={pos.x - 60} y={pos.y + r + 2} width={120} height={16}>
                    <div
                      style={{
                        background: "white", border: "1px solid #e5e0d5", borderRadius: 3,
                        padding: "1px 4px", fontSize: 9, fontWeight: 600, color: "#333",
                        textAlign: "center", whiteSpace: "nowrap", overflow: "hidden",
                        textOverflow: "ellipsis", fontFamily: "sans-serif", lineHeight: "14px",
                        pointerEvents: "none",
                      }}
                    >
                      {short}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </g>
        </svg>
        {selected && (
          <div
            style={{
              position: "absolute", right: 10, top: 10, width: 260, maxHeight: "80%",
              overflowY: "auto", background: "rgba(255,255,255,0.97)",
              border: "1px solid #e5e0d5", borderRadius: 8, padding: "10px 12px",
              fontSize: 12, lineHeight: 1.45, boxShadow: "0 2px 10px rgba(0,0,0,0.08)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <strong style={{ fontSize: 13 }}>{semanticLabel(selected, display)}</strong>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#888" }}
                aria-label="Close details"
              >
                ×
              </button>
            </div>
            <div style={{ color: "#777", marginBottom: 6 }}>{selected.label}</div>
            {selectedEvidence?.traceText ? (
              <blockquote style={{ margin: "0 0 8px", padding: "6px 8px", background: "#f6f3ec", borderLeft: "3px solid #b2462e", fontStyle: "italic" }}>
                “{selectedEvidence.traceText}”
                {selectedEvidence.confidence && (
                  <div style={{ fontStyle: "normal", color: "#777", marginTop: 3 }}>confidence: {selectedEvidence.confidence}</div>
                )}
              </blockquote>
            ) : (
              <div style={{ color: "#a05a2c", marginBottom: 8 }}>no evidence attached</div>
            )}
            {selectedRelations.length > 0 && (
              <div>
                {selectedRelations.map((relation, index) => (
                  <div key={index} style={{ marginBottom: 4 }}>
                    <div>{relation.text}</div>
                    {relation.trace && <div style={{ color: "#888", fontStyle: "italic" }}>“{relation.trace}”</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

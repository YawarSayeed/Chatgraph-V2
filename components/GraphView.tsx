"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3Force from "d3-force";
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
  const name = p.name;
  if (typeof name === "string" && name.length > 0) return name;
  const title = p.title;
  if (typeof title === "string" && title.length > 0) return title;
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

function computeLayout(
  vertices: GraphVertex[],
  edges: { out: string; in: string; label: string }[],
  display?: GraphDisplayConfig
): { nodes: LayoutNode[]; edges: LayoutEdge[] } | null {
  if (vertices.length === 0) return null;

  const simNodes: (LayoutNode & { vx: number; vy: number })[] = vertices.map((v) => ({
    id: v.id,
    label: v.label,
    x: W / 2 + (Math.random() - 0.5) * 40,
    y: H / 2 + (Math.random() - 0.5) * 40,
    vx: 0,
    vy: 0,
  }));

  const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
  const simEdges: { source: LayoutNode & { vx: number; vy: number }; target: LayoutNode & { vx: number; vy: number }; label: string }[] = [];

  for (const e of edges) {
    const src = nodeMap.get(e.out);
    const tgt = nodeMap.get(e.in);
    if (src && tgt) simEdges.push({ source: src, target: tgt, label: e.label });
  }

  const sim = d3Force
    .forceSimulation(simNodes)
    .force("link", d3Force.forceLink(simEdges).distance(90).strength(0.15))
    .force("charge", d3Force.forceManyBody().strength(-200))
    .force("center", d3Force.forceCenter(W / 2, H / 2))
    .force("collision", d3Force.forceCollide().radius((n) => radius((n as LayoutNode).label, display) + 10))
    .alphaDecay(0.04)
    .velocityDecay(0.5)
    .stop();

  sim.alpha(1);
  const totalTicks = Math.ceil(Math.log(0.001) / Math.log(1 - 0.04));
  for (let i = 0; i < totalTicks; i += 1) sim.tick();

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
  const vertexList = useMemo(
    () =>
      Object.values(graph.vertices).filter(
        (vertex) =>
          !hiddenLabels.has(vertex.label) &&
          !hiddenTextPatterns.some((pattern) => pattern.test(semanticLabel(vertex, display)))
      ),
    [display, graph.vertices, hiddenLabels, hiddenTextPatterns]
  );
  const visibleIds = useMemo(() => new Set(vertexList.map((vertex) => vertex.id)), [vertexList]);
  const edgeList = useMemo(
    () =>
      Object.values(graph.edges).filter(
        (edgeItem) =>
          !hiddenEdges.has(edgeItem.label) &&
          visibleIds.has(edgeItem.out) &&
          visibleIds.has(edgeItem.in)
      ),
    [graph.edges, hiddenEdges, visibleIds]
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomGroupRef = useRef<SVGGElement>(null);
  const [layout, setLayout] = useState<{ nodes: LayoutNode[]; edges: LayoutEdge[] } | null>(null);
  const [nodePositions, setNodePositions] = useState<Map<string, Pos>>(new Map());

  // Compute initial layout once when graph changes
  useEffect(() => {
    const result = computeLayout(vertexList, edgeList, display);
    if (result) {
      setLayout(result);
      const pos = new Map<string, Pos>();
      for (const n of result.nodes) pos.set(n.id, { x: n.x, y: n.y });
      setNodePositions(pos);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Setup zoom + drag
  useEffect(() => {
    const svg = svgRef.current;
    const zoomGroup = zoomGroupRef.current;
    if (!svg || !zoomGroup || !layout) return;
    const zg = zoomGroup;

    // eslint-disable-next-line prefer-const
    let currentTransform = { x: 0, y: 0, k: 1 };

    function applyTransform() {
      zg.setAttribute(
        "transform",
        `translate(${currentTransform.x}, ${currentTransform.y}) scale(${currentTransform.k})`
      );
    }

    let isPanning = false;
    let isDragging = false;
    let dragNodeId: string | null = null;
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
      panStartX = e.clientX - currentTransform.x;
      panStartY = e.clientY - currentTransform.y;
      svg.style.cursor = "grabbing";
    };

    const onMouseMove = (e: MouseEvent) => {
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
      if (isDragging || isPanning) svg.style.cursor = "grab";
      isDragging = false;
      isPanning = false;
      dragNodeId = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
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

  return (
    <div className="graph-shell">
      <div className="graph-topline">
        <span>{vertexList.length} vertices</span>
        <span>{edgeList.length} edges</span>
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
              const short = lbl.length > 12 ? lbl.slice(0, 11) + "\u2026" : lbl;
              const c = color(node.label, display);

              return (
                <g key={node.id} style={{ cursor: "pointer" }}>
                  <circle cx={pos.x} cy={pos.y} r={r} fill={c} stroke={c} strokeOpacity={0.25} strokeWidth={5} />
                  <circle cx={pos.x} cy={pos.y} r={r - 1} fill={c} stroke={c} strokeWidth={1.5} />
                  <foreignObject x={pos.x - 36} y={pos.y + r + 2} width={72} height={16}>
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
      </div>
    </div>
  );
}

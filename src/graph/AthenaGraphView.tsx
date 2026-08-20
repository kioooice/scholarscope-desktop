import cytoscape from "cytoscape";
import type { Core, SingularElementArgument } from "cytoscape";
import { GitBranch, Maximize2, Network, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { graphService } from "../services/graphService";
import { useAthenaStore } from "../stores/athenaStore";
import type { GraphNodeType } from "../types/athena";

const nodeColors: Record<GraphNodeType, string> = {
  Paper: "#8bb8ff",
  Author: "#f6c177",
  Concept: "#9be7c1",
  Topic: "#c7a5ff",
  Material: "#f08a9b",
  Method: "#81d8f7",
  Equation: "#f7e58b",
  Institution: "#b7c1ce",
  "Research Area": "#78d6ba",
};

export function AthenaGraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const graph = useAthenaStore((state) => state.graph);
  const uiSettings = useAthenaStore((state) => state.uiSettings);
  const setGraph = useAthenaStore((state) => state.setGraph);
  const setSelectedNodeId = useAthenaStore((state) => state.setSelectedNodeId);
  const [query, setQuery] = useState("");
  const [enabledTypes, setEnabledTypes] = useState<GraphNodeType[]>(["Paper", "Author", "Concept", "Topic", "Material", "Method", "Research Area"]);

  const nodeTypes = useMemo(() => Array.from(new Set(graph?.nodes.map((node) => node.type) ?? [])), [graph]);

  useEffect(() => {
    if (!containerRef.current || !graph) return;
    cyRef.current?.destroy();
    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...graph.nodes.map((node) => ({
          data: { id: node.id, label: node.label, type: node.type, metadata: node.metadata },
          position: node.x && node.y ? { x: node.x, y: node.y } : undefined,
        })),
        ...graph.edges.map((edge) => ({
          data: {
            id: edge.id,
            source: edge.sourceNodeId,
            target: edge.targetNodeId,
            label: edge.relationshipType,
            score: typeof edge.metadata.score === "number" ? edge.metadata.score : 0.2,
          },
        })),
      ],
      style: [
        {
          selector: "node",
          style: {
            "background-color": uiSettings.graphNodeColor,
            label: "data(label)",
            color: uiSettings.textColor,
            "font-size": 11,
            "font-weight": 500,
            "text-max-width": "150px",
            "text-wrap": "ellipsis",
            "text-valign": "bottom",
            "text-margin-y": 10,
            width: 18,
            height: 18,
            "border-color": "rgba(255,255,255,0.18)",
            "border-width": 1,
          },
        },
        {
          selector: 'node[type = "Paper"]',
          style: {
            width: 22,
            height: 22,
            "background-color": uiSettings.graphNodeColor,
          },
        },
        {
          selector: 'node[type != "Paper"]',
          style: {
            "background-color": (element) => nodeColors[element.data("type") as GraphNodeType] ?? uiSettings.graphNodeColor,
            opacity: 0.78,
            width: 14,
            height: 14,
            "font-size": 9,
          },
        },
        {
          selector: "edge",
          style: {
            width: (edge: SingularElementArgument) => Math.max(1, Math.min(4, 1 + edge.data("score") * 4)),
            "line-color": uiSettings.graphEdgeColor,
            "target-arrow-color": uiSettings.graphEdgeColor,
            "target-arrow-shape": "none",
            "curve-style": "straight",
            opacity: (edge: SingularElementArgument) => Math.max(0.28, Math.min(0.9, 0.35 + edge.data("score"))),
          },
        },
        {
          selector: ".highlighted",
          style: {
            "background-color": "#ffffff",
            "line-color": "#ffffff",
            "target-arrow-color": "#ffffff",
            "border-color": "#ffffff",
            "border-width": 2,
          },
        },
        { selector: ".filtered", style: { display: "none" } },
      ],
      layout: {
        name: graph.edges.some((edge) => edge.relationshipType === "Similar To") ? "circle" : "cose",
        animate: uiSettings.smoothUi,
        animationDuration: 650,
        fit: true,
        padding: 54,
      },
      wheelSensitivity: 0.22,
    });

    cy.on("tap", "node", (event) => setSelectedNodeId(event.target.id()));
    cy.on("dragfree", "node", async () => {
      const nextGraph = {
        ...graph,
        nodes: graph.nodes.map((node) => {
          const position = cy.getElementById(node.id).position();
          return { ...node, x: position.x, y: position.y };
        }),
      };
      setGraph(await graphService.saveGraph(nextGraph));
    });
    cyRef.current = cy;
  }, [graph, setGraph, setSelectedNodeId, uiSettings.graphEdgeColor, uiSettings.graphNodeColor, uiSettings.smoothUi, uiSettings.textColor]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass("highlighted filtered");
    cy.nodes().forEach((node) => {
      const matchesQuery = !query || node.data("label").toLowerCase().includes(query.toLowerCase());
      const matchesType = enabledTypes.includes(node.data("type"));
      if (!matchesType) node.addClass("filtered");
      if (matchesQuery && query) node.addClass("highlighted");
    });
  }, [enabledTypes, query]);

  return (
    <main className="page graph-page">
      <section className="toolbar graph-toolbar">
        <div className="search-box">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search graph" />
        </div>
        <button type="button" onClick={() => cyRef.current?.fit(undefined, 40)}><Maximize2 size={16} /> Fit</button>
        <button type="button" onClick={() => cyRef.current?.layout({ name: "circle", animate: true, fit: true, padding: 54 }).run()}><GitBranch size={16} /> Relevance</button>
        <button type="button" onClick={() => cyRef.current?.layout({ name: "cose", animate: true, fit: true, padding: 54 }).run()}><Network size={16} /> Cluster</button>
      </section>
      <section className="filter-band">
        {nodeTypes.map((type) => (
          <label className="check-chip" key={type}>
            <input
              type="checkbox"
              checked={enabledTypes.includes(type)}
              onChange={() => setEnabledTypes((current) => (current.includes(type) ? current.filter((item) => item !== type) : [...current, type]))}
            />
            <span>{type}</span>
          </label>
        ))}
      </section>
      <div className="graph-canvas" ref={containerRef} />
    </main>
  );
}

import { localRepository } from "../database/localRepository";
import type { AthenaGraph, GraphEdge, GraphNode } from "../types/athena";

function mergeNodes(existing: GraphNode[], incoming: GraphNode[]): GraphNode[] {
  const map = new Map(existing.map((node) => [node.id, node]));
  incoming.forEach((node) => map.set(node.id, { ...node, ...map.get(node.id), metadata: { ...node.metadata, ...map.get(node.id)?.metadata } }));
  return Array.from(map.values());
}

function mergeEdges(existing: GraphEdge[], incoming: GraphEdge[]): GraphEdge[] {
  const map = new Map(existing.map((edge) => [edge.id, edge]));
  incoming.forEach((edge) => map.set(edge.id, { ...map.get(edge.id), ...edge }));
  return Array.from(map.values());
}

export const graphService = {
  async addNode(node: GraphNode): Promise<AthenaGraph> {
    const graph = await this.getGraph();
    return localRepository.saveGraph({ ...graph, nodes: mergeNodes(graph.nodes, [node]) });
  },

  async addEdge(edge: GraphEdge): Promise<AthenaGraph> {
    const graph = await this.getGraph();
    return localRepository.saveGraph({ ...graph, edges: mergeEdges(graph.edges, [edge]) });
  },

  async getGraph(): Promise<AthenaGraph> {
    return localRepository.loadGraph();
  },

  async saveGraph(graph: AthenaGraph): Promise<AthenaGraph> {
    return localRepository.saveGraph(graph);
  },

  async mergeGraph(incoming: AthenaGraph): Promise<AthenaGraph> {
    const existing = await this.getGraph();
    return localRepository.saveGraph({
      nodes: mergeNodes(existing.nodes, incoming.nodes),
      edges: mergeEdges(existing.edges, incoming.edges),
    });
  },
};

import type { AthenaGraph, GraphEdge, GraphNode, KnowledgeExtraction, Paper } from "../types/athena";

const materialPatterns = [/MAPbI3/gi, /graphene/gi, /semiconductor/gi, /superconductor/gi, /quantum material/gi];
const methodPatterns = [/density functional theory|DFT/gi, /x-ray diffraction|XRD/gi, /spectroscopy/gi, /transport measurement/gi, /zero-noise extrapolation/gi];
const equationPatterns = [/Schrodinger/gi, /Kohn-Sham/gi, /Hamiltonian/gi, /band gap/gi];

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function collect(patterns: RegExp[], source: string): string[] {
  return unique(patterns.flatMap((pattern) => source.match(pattern) ?? []));
}

function nodeId(type: string, label: string): string {
  return `${type.toLowerCase()}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function paperTerms(paper: Paper): string[] {
  return unique([...paper.topics, ...paper.concepts, ...paper.keywords, ...paper.authors.map((author) => `author:${author}`)].map((item) => item.toLowerCase()));
}

function relevanceScore(source: Paper, target: Paper): { score: number; sharedTerms: string[] } {
  const sourceTerms = new Set(paperTerms(source));
  const targetTerms = new Set(paperTerms(target));
  const sharedTerms = [...sourceTerms].filter((term) => targetTerms.has(term));
  const unionSize = new Set([...sourceTerms, ...targetTerms]).size || 1;
  const topicOverlap = source.topics.filter((topic) => target.topics.map((item) => item.toLowerCase()).includes(topic.toLowerCase())).length;
  const authorOverlap = source.authors.filter((author) => target.authors.map((item) => item.toLowerCase()).includes(author.toLowerCase())).length;
  const score = Math.min(1, sharedTerms.length / unionSize + topicOverlap * 0.12 + authorOverlap * 0.22);
  return { score, sharedTerms: sharedTerms.map((term) => term.replace(/^author:/, "")).slice(0, 8) };
}

export const knowledgeExtractionService = {
  extractConcepts(paper: Paper): string[] {
    const terms = [...paper.concepts, ...paper.keywords];
    return unique(terms).slice(0, 12);
  },

  extractTopics(paper: Paper): string[] {
    return unique([...paper.topics, ...paper.concepts.filter((concept) => concept.includes("Science"))]).slice(0, 10);
  },

  extract(paper: Paper): KnowledgeExtraction {
    const text = `${paper.title} ${paper.abstract} ${paper.concepts.join(" ")} ${paper.topics.join(" ")}`;
    return {
      concepts: this.extractConcepts(paper),
      topics: this.extractTopics(paper),
      materials: collect(materialPatterns, text),
      methods: collect(methodPatterns, text),
      equations: collect(equationPatterns, text),
      institutions: [],
      researchAreas: unique(paper.topics),
    };
  },

  createGraphNodes(paper: Paper): AthenaGraph {
    const extraction = this.extract(paper);
    const paperNode: GraphNode = {
      id: `paper-${paper.id}`,
      type: "Paper",
      label: paper.title,
      refId: paper.id,
      metadata: { year: paper.year, citations: paper.citationCount, openAccess: paper.isOpenAccess },
    };

    const typedNodes: GraphNode[] = [
      ...paper.authors.map((label) => ({ id: nodeId("author", label), type: "Author" as const, label, metadata: {} })),
      ...extraction.concepts.map((label) => ({ id: nodeId("concept", label), type: "Concept" as const, label, metadata: {} })),
      ...extraction.topics.map((label) => ({ id: nodeId("topic", label), type: "Topic" as const, label, metadata: {} })),
      ...extraction.materials.map((label) => ({ id: nodeId("material", label), type: "Material" as const, label, metadata: {} })),
      ...extraction.methods.map((label) => ({ id: nodeId("method", label), type: "Method" as const, label, metadata: {} })),
      ...extraction.equations.map((label) => ({ id: nodeId("equation", label), type: "Equation" as const, label, metadata: {} })),
      ...extraction.researchAreas.map((label) => ({ id: nodeId("area", label), type: "Research Area" as const, label, metadata: {} })),
    ];

    const nodes = [paperNode, ...typedNodes];
    const edges: GraphEdge[] = typedNodes.map((node) => ({
      id: `edge-${paperNode.id}-${node.id}`,
      sourceNodeId: paperNode.id,
      targetNodeId: node.id,
      relationshipType:
        node.type === "Author" ? "Authored By" : node.type === "Method" ? "Uses Method" : node.type === "Material" ? "Studies" : "Related To",
      metadata: {},
    }));

    return { nodes, edges };
  },

  createLibraryGraph(papers: Paper[]): AthenaGraph {
    const paperNodes: GraphNode[] = papers.map((paper, index) => {
      const angle = papers.length ? (Math.PI * 2 * index) / papers.length - Math.PI / 2 : 0;
      const radius = Math.max(170, Math.min(420, papers.length * 42));
      return {
        id: `paper-${paper.id}`,
        type: "Paper",
        label: paper.title,
        refId: paper.id,
        metadata: {
          year: paper.year,
          citations: paper.citationCount,
          openAccess: paper.isOpenAccess,
          topics: paper.topics.slice(0, 6),
        },
        x: 520 + Math.cos(angle) * radius,
        y: 360 + Math.sin(angle) * radius,
      };
    });

    const relevanceCandidates: Array<{ source: Paper; target: Paper; score: number; sharedTerms: string[] }> = [];
    for (let sourceIndex = 0; sourceIndex < papers.length; sourceIndex += 1) {
      for (let targetIndex = sourceIndex + 1; targetIndex < papers.length; targetIndex += 1) {
        const source = papers[sourceIndex];
        const target = papers[targetIndex];
        const relevance = relevanceScore(source, target);
        relevanceCandidates.push({ source, target, score: relevance.score, sharedTerms: relevance.sharedTerms });
      }
    }

    const relevanceEdges: GraphEdge[] = [];
    const connectedPaperIds = new Set<string>();
    relevanceCandidates
      .sort((a, b) => b.score - a.score)
      .forEach((candidate) => {
        const strongMatch = candidate.score >= 0.08 || candidate.sharedTerms.length >= 2;
        const usefulFallback = candidate.score > 0 && (!connectedPaperIds.has(candidate.source.id) || !connectedPaperIds.has(candidate.target.id));
        if (!strongMatch && !usefulFallback) return;
        if (relevanceEdges.length >= Math.max(papers.length * 2, 4) && !strongMatch) return;
        relevanceEdges.push({
          id: `edge-paper-${candidate.source.id}-paper-${candidate.target.id}`,
          sourceNodeId: `paper-${candidate.source.id}`,
          targetNodeId: `paper-${candidate.target.id}`,
          relationshipType: "Similar To",
          metadata: { score: Number(candidate.score.toFixed(2)), sharedTerms: candidate.sharedTerms },
        });
        connectedPaperIds.add(candidate.source.id);
        connectedPaperIds.add(candidate.target.id);
      });

    return { nodes: paperNodes, edges: relevanceEdges };
  },
};

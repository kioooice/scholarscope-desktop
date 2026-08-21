export type SearchType = "topic" | "title" | "doi" | "author" | "keywords";
export type SearchSource = "OpenAlex" | "Unpaywall" | "arXiv" | "Crossref" | "PubMed" | "Semantic Scholar" | "Google Scholar";

export type GraphNodeType =
  | "Paper"
  | "Author"
  | "Concept"
  | "Topic"
  | "Material"
  | "Method"
  | "Equation"
  | "Institution"
  | "Research Area";

export type GraphEdgeType =
  | "Cites"
  | "Similar To"
  | "Authored By"
  | "Uses Method"
  | "Studies"
  | "Related To"
  | "Derived From"
  | "Free Alternative To"
  | "Contradicts"
  | "Supports"
  | "Improves Upon"
  | "Mentioned In";

export type Paper = {
  id: string;
  openalexId?: string;
  doi?: string;
  title: string;
  authors: string[];
  abstract: string;
  journal?: string;
  year?: number;
  publisher?: string;
  citationCount: number;
  publisherUrl?: string;
  oaUrl?: string;
  pdfUrl?: string;
  chinesePlatformUrls?: Partial<Record<"cnki" | "wanfang" | "cqvip", string>>;
  isOpenAccess: boolean;
  sourceProvider: SearchSource;
  concepts: string[];
  topics: string[];
  keywords: string[];
  references: string[];
  relatedPapers: string[];
  dateAdded?: string;
  favorite?: boolean;
  tags?: string[];
  notes?: string;
};

export type SearchFilters = {
  disciplines: string[];
  openAccessOnly: boolean;
  minYear?: number;
  maxYear?: number;
  minCitations?: number;
};

export type SearchRequest = {
  query: string;
  type: SearchType;
  filters: SearchFilters;
};

export type AgentStepStatus = "pending" | "running" | "done" | "error";
export type EvidenceStance = "supports" | "contradicts" | "neutral" | "unclear";
export type QualityStatus = "strong" | "moderate" | "weak" | "unknown";

export type QualitySignal = {
  status: QualityStatus;
  label: string;
  detail: string;
};

export type QualityAssessment = {
  overallScore: number;
  overallLabel: QualityStatus;
  journal: QualitySignal;
  citations: QualitySignal;
  recency: QualitySignal;
  methodology: QualitySignal;
  sampleSize: QualitySignal;
  conflicts: QualitySignal;
  funding: QualitySignal;
  limitations: string[];
};

export type AgentStep = {
  id: string;
  label: string;
  status: AgentStepStatus;
  detail?: string;
};

export type ResearchAnswerSource = {
  paperId: string;
  title: string;
  authors: string[];
  year?: number;
  sourceProvider: SearchSource;
  citationCount: number;
  url?: string;
  pdfUrl?: string;
  evidence: string;
  dataPoints: string[];
  evidenceLabel?: EvidenceStance;
  confidence?: number;
  reasoning?: string;
  quality?: QualityAssessment;
};

export type ExternalSearchLink = {
  provider: SearchSource;
  label: string;
  url: string;
  note: string;
};

export type ResearchAgentAnswer = {
  question: string;
  searchQuery: string;
  directAnswer?: string;
  overview: string;
  keyFindings: string[];
  sourceNotes: ResearchAnswerSource[];
  followUpQueries: string[];
  aiEnhanced?: boolean;
};

export type ResearchAgentResult = {
  papers: Paper[];
  importedPapers: Paper[];
  alternatives: AlternativePaper[];
  externalSearches: ExternalSearchLink[];
  steps: AgentStep[];
  answer?: ResearchAgentAnswer;
};

export type GraphNode = {
  id: string;
  type: GraphNodeType;
  label: string;
  refId?: string;
  metadata: Record<string, unknown>;
  x?: number;
  y?: number;
};

export type GraphEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: GraphEdgeType;
  metadata: Record<string, unknown>;
};

export type AthenaGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type KnowledgeExtraction = {
  concepts: string[];
  topics: string[];
  materials: string[];
  methods: string[];
  equations: string[];
  institutions: string[];
  researchAreas: string[];
};

export type AlternativePaper = {
  id: string;
  title: string;
  source: SearchSource;
  coverageEstimate: number;
  openAccessLink?: string;
  doi?: string;
  authors: string[];
  year?: number;
  reason: string;
};

export type AthenaNote = {
  id: string;
  title: string;
  content: string;
  linkedNodeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type UiDensity = "compact" | "comfortable";

export type UiSettings = {
  accentColor: string;
  graphNodeColor: string;
  graphEdgeColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  density: UiDensity;
  smoothUi: boolean;
};

export type AiProviderMode = "off" | "openai" | "ollama" | "compatible";

export type ProviderSettings = {
  semanticScholarApiKey: string;
  ncbiApiKey: string;
  crossrefEmail: string;
  googleScholarApiKey: string;
  aiProvider: AiProviderMode;
  aiBaseUrl: string;
  aiModel: string;
  aiApiKey: string;
  aiSemanticExpansion: boolean;
  aiEvidenceLabels: boolean;
  aiAnswerSynthesis: boolean;
  aiQualityValidation: boolean;
};

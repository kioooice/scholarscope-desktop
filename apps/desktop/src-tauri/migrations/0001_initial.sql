PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY,
  openalex_id TEXT,
  doi TEXT,
  title TEXT NOT NULL,
  abstract TEXT,
  year INTEGER,
  journal TEXT,
  citation_count INTEGER NOT NULL DEFAULT 0,
  publisher_url TEXT,
  oa_url TEXT,
  pdf_url TEXT,
  is_open_access INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS authors (
  id TEXT PRIMARY KEY,
  openalex_id TEXT,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS concepts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  ref_id TEXT,
  metadata_json TEXT NOT NULL,
  x REAL,
  y REAL
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id TEXT PRIMARY KEY,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_authors (
  paper_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  PRIMARY KEY (paper_id, author_id)
);

CREATE TABLE IF NOT EXISTS paper_topics (
  paper_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  PRIMARY KEY (paper_id, topic_id)
);

CREATE TABLE IF NOT EXISTS paper_concepts (
  paper_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  PRIMARY KEY (paper_id, concept_id)
);

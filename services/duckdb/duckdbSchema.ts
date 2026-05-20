// QNBS-v3: Canonical DDL for the DuckDB-WASM analytics layer.
//          IDB remains the source of truth; this schema is the read-optimised side-car.

export const DUCK_DB_SCHEMA_VERSION = 1;

export const DUCKDB_DDL = `
CREATE TABLE IF NOT EXISTS _meta (
  key   VARCHAR PRIMARY KEY,
  value VARCHAR
);

CREATE TABLE IF NOT EXISTS projects (
  project_id         VARCHAR PRIMARY KEY,
  title              VARCHAR,
  logline            VARCHAR,
  total_word_count   INTEGER,
  target_word_count  INTEGER,
  target_date        DATE,
  created_at         TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sections (
  section_id       VARCHAR PRIMARY KEY,
  project_id       VARCHAR REFERENCES projects(project_id),
  title            VARCHAR,
  word_count       INTEGER,
  status           VARCHAR,
  act              TINYINT,
  position         INTEGER,
  scene_start      VARCHAR,
  pov_character_id VARCHAR,
  character_ids    VARCHAR[],
  world_ids        VARCHAR[],
  color            VARCHAR,
  content_enc      BLOB,
  content_iv       BLOB,
  summary_enc      BLOB,
  summary_iv       BLOB,
  notes_enc        BLOB,
  notes_iv         BLOB,
  indexed_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS writing_history (
  project_id VARCHAR,
  date       DATE,
  words      INTEGER,
  PRIMARY KEY (project_id, date)
);

CREATE TABLE IF NOT EXISTS writing_sessions (
  session_id     VARCHAR PRIMARY KEY,
  project_id     VARCHAR,
  session_date   DATE,
  start_time     TIME,
  end_time       TIME,
  words_written  INTEGER,
  section_id     VARCHAR,
  notes_enc      BLOB,
  notes_iv       BLOB
);

CREATE TABLE IF NOT EXISTS characters (
  character_id     VARCHAR PRIMARY KEY,
  project_id       VARCHAR,
  name             VARCHAR,
  has_avatar       BOOLEAN,
  backstory_enc    BLOB,
  backstory_iv     BLOB,
  motivation_enc   BLOB,
  motivation_iv    BLOB,
  appearance_enc   BLOB,
  appearance_iv    BLOB,
  notes_enc        BLOB,
  notes_iv         BLOB
);

CREATE TABLE IF NOT EXISTS plot_connections (
  connection_id   VARCHAR PRIMARY KEY,
  project_id      VARCHAR,
  from_section_id VARCHAR,
  to_section_id   VARCHAR,
  connection_type VARCHAR,
  label           VARCHAR,
  subplot_id      VARCHAR
);

CREATE TABLE IF NOT EXISTS codex_entities (
  entity_id    VARCHAR,
  project_id   VARCHAR,
  name         VARCHAR,
  entity_type  VARCHAR,
  mention_count INTEGER,
  PRIMARY KEY (entity_id, project_id)
);

CREATE TABLE IF NOT EXISTS codex_mentions (
  entity_id  VARCHAR,
  project_id VARCHAR,
  section_id VARCHAR,
  excerpt    VARCHAR,
  PRIMARY KEY (entity_id, project_id, section_id)
);

CREATE TABLE IF NOT EXISTS rag_chunks (
  chunk_id   VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  section_id VARCHAR,
  chunk_index INTEGER,
  text_enc   BLOB,
  text_iv    BLOB,
  vector     FLOAT[],
  indexed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cross_project_index (
  project_id           VARCHAR PRIMARY KEY,
  title                VARCHAR,
  logline              VARCHAR,
  manuscript_word_count INTEGER,
  character_names      VARCHAR[],
  embedding_vector     FLOAT[],
  last_indexed         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS readability_snapshots (
  snapshot_id        VARCHAR PRIMARY KEY,
  project_id         VARCHAR,
  sampled_at         TIMESTAMPTZ,
  locale             VARCHAR(5),
  flesch_score       DOUBLE,
  word_count_sample  INTEGER
);

-- Analytics views (plaintext columns only — no encrypted BLOBs)
CREATE OR REPLACE VIEW v_daily_progress AS
SELECT
  project_id,
  date,
  words,
  AVG(words) OVER (
    PARTITION BY project_id
    ORDER BY date
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) AS rolling_7day_avg
FROM writing_history;

CREATE OR REPLACE VIEW v_weekly_progress AS
SELECT
  project_id,
  DATE_TRUNC('week', date) AS week_start,
  SUM(words) AS weekly_words
FROM writing_history
GROUP BY project_id, DATE_TRUNC('week', date);

CREATE OR REPLACE VIEW v_section_metrics AS
SELECT
  s.project_id,
  s.act,
  s.section_id,
  s.title,
  s.word_count,
  s.status,
  SUM(s.word_count) OVER (PARTITION BY s.project_id, s.act) AS act_word_count,
  RANK() OVER (PARTITION BY s.project_id ORDER BY s.word_count DESC) AS word_count_rank
FROM sections s;

CREATE OR REPLACE VIEW v_scene_overlap AS
SELECT
  a.section_id AS section_a,
  b.section_id AS section_b,
  a.project_id,
  a.scene_start AS scene_start_a,
  b.scene_start AS scene_start_b
FROM sections a
JOIN sections b
  ON  a.project_id = b.project_id
  AND a.section_id < b.section_id
  AND a.scene_start IS NOT NULL
  AND b.scene_start IS NOT NULL
  AND a.scene_start = b.scene_start;

CREATE OR REPLACE VIEW v_character_cooccurrence AS
SELECT
  m1.entity_id  AS character_a,
  m2.entity_id  AS character_b,
  m1.project_id,
  COUNT(*)      AS shared_sections
FROM codex_mentions m1
JOIN codex_mentions m2
  ON  m1.project_id = m2.project_id
  AND m1.section_id = m2.section_id
  AND m1.entity_id  < m2.entity_id
GROUP BY m1.entity_id, m2.entity_id, m1.project_id;
`;

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  request_text TEXT NOT NULL,
  location_text TEXT NOT NULL,
  status TEXT NOT NULL,
  target_quotes INTEGER NOT NULL,
  normalized_query TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT,
  rating REAL,
  review_count INTEGER NOT NULL DEFAULT 0,
  reviews_text TEXT NOT NULL DEFAULT '[]',
  lat REAL,
  lng REAL,
  distance_km REAL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS call_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  twilio_call_sid TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  failure_reason TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id TEXT PRIMARY KEY,
  call_attempt_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (call_attempt_id) REFERENCES call_attempts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  price_min REAL,
  price_max REAL,
  currency TEXT,
  timeline_days INTEGER,
  notes TEXT,
  confidence REAL NOT NULL,
  is_complete INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_vendor_unique ON quotes(vendor_id);

CREATE TABLE IF NOT EXISTS rankings (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  price_score REAL NOT NULL,
  rating_score REAL NOT NULL,
  distance_score REAL NOT NULL,
  total_score REAL NOT NULL,
  rank INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vendors_job ON vendors(job_id);
CREATE INDEX IF NOT EXISTS idx_calls_job ON call_attempts(job_id);
CREATE INDEX IF NOT EXISTS idx_quotes_job ON quotes(job_id);
CREATE INDEX IF NOT EXISTS idx_rankings_job ON rankings(job_id);

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text,
  session_token text NOT NULL UNIQUE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS books (
  id text PRIMARY KEY,
  title text NOT NULL,
  authors jsonb NOT NULL DEFAULT '[]'::jsonb,
  isbn13 text,
  isbn10 text,
  year integer,
  description text,
  subjects jsonb NOT NULL DEFAULT '[]'::jsonb,
  cover_url text,
  language text,
  thin boolean NOT NULL DEFAULT false,
  metadata_source text,
  open_library_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS books_isbn13_uidx ON books (isbn13) WHERE isbn13 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS books_open_library_key_uidx ON books (open_library_key) WHERE open_library_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS book_tags (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books (id),
  user_id text REFERENCES users (id),
  axis text NOT NULL,
  phrase text NOT NULL,
  confidence real NOT NULL,
  evidence text NOT NULL,
  prompt_version integer NOT NULL,
  usable boolean NOT NULL
);

CREATE INDEX IF NOT EXISTS book_tags_book_idx ON book_tags (book_id);

CREATE TABLE IF NOT EXISTS book_embeddings (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books (id),
  axis text NOT NULL,
  embedding vector(256) NOT NULL,
  model text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS book_embeddings_book_axis_uidx ON book_embeddings (book_id, axis);

CREATE TABLE IF NOT EXISTS user_books (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id),
  book_id text NOT NULL REFERENCES books (id),
  shelf text NOT NULL,
  rating real,
  date_read text,
  date_added text,
  source text NOT NULL,
  review_text text,
  rating_changed_in_app boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_books_user_book_uidx ON user_books (user_id, book_id);

CREATE TABLE IF NOT EXISTS import_batches (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id),
  use_review_text boolean NOT NULL DEFAULT false,
  total_rows integer NOT NULL,
  status text NOT NULL,
  added_count integer NOT NULL DEFAULT 0,
  changed_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  received_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_rows (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES import_batches (id),
  source_index integer NOT NULL,
  original jsonb NOT NULL,
  status text NOT NULL,
  confidence real NOT NULL DEFAULT 0,
  candidate jsonb,
  book_id text REFERENCES books (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS import_rows_batch_source_uidx ON import_rows (batch_id, source_index);
CREATE INDEX IF NOT EXISTS import_rows_batch_idx ON import_rows (batch_id);

CREATE TABLE IF NOT EXISTS enrichment_jobs (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books (id),
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS enrichment_jobs_pending_idx ON enrichment_jobs (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS enrichment_jobs_book_idx ON enrichment_jobs (book_id);

CREATE TABLE IF NOT EXISTS tag_reviews (
  id text PRIMARY KEY,
  book_id text NOT NULL UNIQUE REFERENCES books (id),
  user_id text REFERENCES users (id),
  accurate boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

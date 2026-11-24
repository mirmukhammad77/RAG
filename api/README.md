# RAG backend

NestJS and TypeScript backend using PostgreSQL, Drizzle for entity definitions and queries, and Sequelize CLI for migrations. DTO validation uses class-validator and class-transformer. Zod validates environment configuration and is available through `ZodValidationPipe`.

## Setup

Run the commands in this document from the `api` directory.

1. Install Node.js 22.13 or newer and run `npm ci`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`.
3. Create the PostgreSQL database. The server must have pgvector installed and the migration user must have permission to enable it.
4. Run `npm run migration:run` to enable pgvector and create the document tables.
5. Run `npm run start:dev`.

The application checks the database connection during startup. There is no authentication. MiniLM runs locally on the CPU; no embedding API key is needed. The first import or search downloads `Xenova/all-MiniLM-L6-v2` from Hugging Face into `MODEL_CACHE_DIR` (default `.cache/models`). Keep that directory writable and persistent to reuse the model across restarts.

If PostgreSQL reports that the `vector` extension is unavailable, it must be installed on the database server before the migrations can run. The repository's `compose.yaml` provides a PostgreSQL 17 server with pgvector: start Docker Desktop, run `docker compose up -d database` from the repository root, and set `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/rag`. See the [pgvector installation instructions](https://github.com/pgvector/pgvector#installation) to add it to an existing PostgreSQL installation instead.

## Database browser

Drizzle Studio is installed as a development tool. Start the configured PostgreSQL database and run migrations, then run:

```sh
npm run db:studio
```

Open [Drizzle Studio](https://local.drizzle.studio) in your browser and keep the terminal command running. Its local connection server listens on `127.0.0.1:4983` and reads `DATABASE_URL` from `api/.env`. The NestJS API does not need to be running to use Studio. You can inspect the `documents` and `document_chunks` tables, including passage text, page references, and stored embedding values.

The same command works from the repository root. Configuration lives in `api/drizzle.config.ts` and discovers Drizzle schemas in feature modules' `entities/` directories. Schema migrations continue to use the existing Sequelize CLI commands.

## Book import and retrieval

The initial version accepts text-based PDFs, either as a multipart upload or a direct public HTTP/HTTPS PDF URL. A book's web page or a sign-in/download page is not a direct PDF link. Scanned PDFs need OCR and are rejected when no text can be extracted. Limits are 50 MiB, 2,000 pages, and 20,000 chunks per book.

Imports run synchronously. Wait for the `201` response before treating a book as indexed; allow a longer client timeout for large books and the first model download. One book import runs at a time per API process; competing imports receive `503` and can be retried. Embeddings are generated before the database transaction starts. A failure leaves no partial document or chunks. Importing the same book again creates another document.

| Method | Route | Input / result |
| --- | --- | --- |
| POST | `/documents/upload` | Multipart `file`, required `title`, optional `edition`; returns book metadata and `chunk_count` |
| POST | `/documents/import-url` | JSON `title`, `source_url`, optional `edition`; returns book metadata and `chunk_count` |
| POST | `/documents/ask` | JSON `question`, optional `document_id`, optional `limit` (1-10, default 5); returns a Gemini answer with cited passages |
| POST | `/documents/ask/stream` | Same input as `/documents/ask`; streams textbook chunks, answer text, and a validated final answer using SSE |
| GET | `/documents` | Newest books first; optional `limit` (1–100, default 20), `offset` (default 0) |
| GET | `/documents/:id` | One book, or 404 |
| GET | `/documents/:id/chunks` | Chunks in reading order, without vectors; supports `limit` and `offset` |
| POST | `/documents/search` | JSON `query`, optional `document_id`, optional `limit` (1–50, default 5); returns nearest passages and book metadata |

Upload a book (use `curl.exe` in Windows PowerShell):

```sh
curl -X POST http://localhost:3000/documents/upload \
  -F "file=@biology.pdf" -F "title=Biology" -F "edition=2nd"
```

Import a link:

```sh
curl -X POST http://localhost:3000/documents/import-url \
  -H 'Content-Type: application/json' \
  -d '{"title":"Biology","source_url":"https://example.org/biology.pdf"}'
```

Search the imported books:

```sh
curl -X POST http://localhost:3000/documents/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"How does DNA store genetic information?","limit":5}'
```

Search uses cosine distance and returns `similarity = 1 - cosine_distance`, with the closest passages first. It always returns up to the requested number of neighbors, even for unrelated queries; similarity is not a calibrated confidence score. Queries above 254 MiniLM tokens are rejected rather than silently truncated. Use `/documents/ask` to generate an answer from the retrieved passages.

## Gemini question answering

Set these values in `api/.env` (or `.env` when working in the API directory), then restart the API:

```dotenv
GEMINI_API_KEY=your-google-ai-studio-api-key
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_TIMEOUT_MS=30000
GEMINI_STREAM_MAX_MS=120000
```

Create a key in [Google AI Studio](https://aistudio.google.com/api-keys). The backend uses the [Gemini generateContent REST API](https://ai.google.dev/api/generate-content) with [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite). No additional SDK is required. The key stays on the server. It is optional for startup, importing, and search; asking questions without a key returns `503`. Model and timeout have the defaults above; the timeout can range from 1,000 to 120,000 milliseconds.

Ask about previously imported books from PowerShell:

```powershell
$body = @{ question = 'How does DNA store genetic information?'; limit = 5 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/documents/ask' -ContentType 'application/json' -Body $body
```

Add `document_id` to restrict retrieval to a particular book; otherwise all imported books are searched. Questions must be nonempty, at most 2,000 characters, and fit within 254 MiniLM tokens. `limit` controls the number of passages sent to Gemini, with a default of 5 and a maximum of 10. Each request is independent; conversation history is not stored or sent.

MiniLM embeds the question locally. The existing pgvector search retrieves the passages. The backend sends Gemini the question, passage content, book title and edition, section heading paths, and physical PDF page ranges. This transmits the retrieved excerpts to Google's Gemini API. Gemini is instructed to answer using only those passages, cite factual claims with `[1]`, `[2]`, etc., and report insufficient context for unrelated or unsupported questions. Question and passage text are treated as untrusted data in the system instructions.

Example response (IDs abbreviated):

```json
{
  "question": "How does DNA store genetic information?",
  "answer": "DNA stores genetic information in its sequence of nucleotide bases. [1]",
  "answerable": true,
  "model": "gemini-3.1-flash-lite",
  "sources": [{
    "citation_id": 1,
    "id": "chunk-uuid",
    "document_id": "book-uuid",
    "position": 0,
    "title": "Biology",
    "edition": "2nd",
    "source_url": null,
    "heading_path": ["Chapter 1", "1.1 DNA"],
    "page_start": 12,
    "page_end": 13,
    "content": "DNA stores genetic information in its sequence of nucleotide bases.",
    "similarity": 0.91
  }]
}
```

Sources contain only the cited passages, with metadata from the database. Citation IDs refer to retrieval order and can have gaps. No embedding vectors are returned. The backend validates the structured answer and checks that inline citation IDs match real retrieved sources. This validates source references; it does not independently prove every generated claim. Page numbers count physical PDF pages from 1; heading paths can be empty when a PDF has no usable bookmarks.

An empty retrieval skips Gemini. Empty or insufficient context returns `200` with `answerable: false`, an explanatory answer, and `sources: []`. An unknown `document_id` returns `404`; invalid input returns `400`; missing Gemini configuration returns `503` before retrieval. If retrieval succeeds but Gemini fails, `/documents/ask` returns `200` with an extractive fallback described below. `generation_error` contains a safe error message and `statusCode`: `429` for quota/rate limits, `503` for server errors, `504` for timeouts, or `502` for rejected/invalid/incomplete answers. Import, embedding, database, and validation errors still fail normally.

The fallback selects up to four complete textbook sentences by question-term overlap, favoring coverage of different question terms, and removes duplicate sentences from overlapping passages. It copies the wording with whitespace normalized, adds numbered source references, and returns:

```json
{
  "status": "extractive_fallback",
  "answer_type": "extractive",
  "answer": "Gemini is unavailable. Relevant textbook excerpts:\n\n> An artery is a blood vessel that carries blood away from the heart. [2]",
  "answerable": null,
  "excerpts": [{ "text": "An artery is a blood vessel that carries blood away from the heart.", "citation_id": 2 }]
}
```

The full response also includes `question`, the attempted Gemini `model`, cited `sources` with their original headings and page ranges, all retrieved `chunks`, and `generation_error`. This extraction runs locally and makes no additional model request. It is a set of relevant quotes, not a Gemini-generated explanation. `answerable` remains `null` because word overlap does not establish whether the excerpts fully answer the question. If no complete matching sentences are available, the status is `retrieval_only`, `answer_type` is `unavailable`, and `answer` contains an explanation instead of `null`; `excerpts` and `sources` are empty. Lexical matching and plural normalization currently target English. Irrelevant passages and cut-off final sentences are not used as excerpts.

Upstream error bodies and API keys are not exposed. Temporary server errors (`500`, `502`, `503`, `504`) are retried up to twice with exponential backoff and jitter, within the same request deadline. Quota errors are not automatically retried; check the project's [active limits in Google AI Studio](https://aistudio.google.com/rate-limit) and billing. Retries cannot resolve persistent model overload or increase a quota.

### Stream the answer in chunks

Use `POST /documents/ask/stream` with the same JSON body. The response uses Server-Sent Events (`text/event-stream`). Unlike the normal endpoint, retrieved textbook chunks are sent as soon as retrieval finishes, before waiting for Gemini. Answer text follows as Gemini generates it through its [streamGenerateContent API](https://ai.google.dev/api/generate-content). Use a client that reads the response body incrementally; waiting for `response.json()` will not work for this route.

From PowerShell, use `curl.exe -N` to show events without buffering:

```powershell
$body = @{ question = 'How does DNA store genetic information?'; limit = 3 } | ConvertTo-Json -Compress
$body | curl.exe -N -X POST 'http://localhost:3000/documents/ask/stream' -H 'Content-Type: application/json' --data-binary '@-'
```

Events arrive in this order:

1. `chunks`: `{ question, model, chunks }`. Every chunk includes `citation_id`, passage content, book metadata, heading path, and physical page range.
2. `delta`: `{ text }`. Append each piece of answer text to the display. These pieces are provisional until the final event.
3. `done`: the complete answer with validated citations and cited `sources`. Use this authoritative final answer, which can also report insufficient context.

If Gemini fails, the stream ends with a `fallback` event instead of `done`. It contains the same extractive fallback response described above, including its `answer`, cited excerpts, all retrieved chunks, and `generation_error`. Replace provisional answer text with the fallback's answer and show its `answer_type`. A terminal `error` event signals an unexpected server failure after streaming began. Once SSE headers have been sent, the HTTP status remains `200`; clients must inspect the terminal event. Errors before streaming starts retain their normal HTTP status codes.

For streaming, `GEMINI_TIMEOUT_MS` is the maximum idle time waiting for upstream data and resets when Gemini sends data. `GEMINI_STREAM_MAX_MS` caps the entire generation at 120,000 ms by default (configurable from 1,000 to 300,000 ms). The normal endpoint still uses `GEMINI_TIMEOUT_MS` as its total generation deadline. Streaming sends partial answers sooner, but a provider that sends no data can still time out; the textbook chunks remain available. Disconnecting the client cancels the upstream request. Keep-alive comments are sent every 15 seconds while the stream is open.

## Data model

`documents` contains exactly one row per completed book import:

| Column | PostgreSQL type | Meaning |
| --- | --- | --- |
| `id` | `uuid` | Generated book ID |
| `title` | `text NOT NULL` | User-provided title |
| `edition` | `text` | Optional user-provided edition |
| `source_url` | `text` | Original URL for a link import; NULL for an upload |
| `created_at` | `timestamptz` | Import time |

`document_chunks` contains one row per searchable passage:

| Column | PostgreSQL type | Meaning |
| --- | --- | --- |
| `id` | `uuid` | Generated chunk ID |
| `document_id` | `uuid NOT NULL` | Foreign key to `documents`; deleting a book cascades to its chunks |
| `position` | `integer NOT NULL` | Zero-based reading order, unique within the book |
| `heading_path` | `text[] NOT NULL` | PDF bookmark hierarchy, e.g. `{"Chapter 1","1.1 DNA"}`; empty when unavailable |
| `page_start` | `integer NOT NULL` | First physical PDF page, counted from 1 |
| `page_end` | `integer NOT NULL` | Last physical PDF page, inclusive |
| `content` | `text NOT NULL` | Extracted passage for retrieval and future chat context |
| `embedding` | `vector(384) NOT NULL` | Normalized MiniLM embedding |

Page numbers refer to physical PDF pages, not printed page labels. Bookmark titles are matched against extracted text so a mid-page section change does not relabel earlier text. Heading extraction is best effort; PDFs without usable bookmarks keep an empty hierarchy. Chunks preserve extracted text and punctuation, stop at identified section boundaries, and use the model's tokenizer to stay within 220 tokens with up to 32 tokens of overlap. This fits MiniLM's 256-token context without truncating passages. Text extraction follows the PDF's text order; complex multi-column layouts may need more advanced extraction later.

The chunk index uses HNSW with `vector_cosine_ops`. The database has two domain tables; Sequelize CLI also maintains its own `SequelizeMeta` migration bookkeeping table. The original PDF file is not persisted.

URL imports reject private, loopback, link-local and other non-public IP ranges, validate every redirect, and pin connections to validated DNS addresses. Downloads have a 30-second timeout and enforce the byte limit while streaming.

## Structure

```text
api/
  src/
    app.module.ts
    main.ts
    modules/
      database/
        database.module.ts
        database.constants.ts
        services/
          database.service.ts
      <name>.module/
        <name>.module.ts
        controllers/
        services/
        repositories/
        dtos/          # when needed
        entities/      # Drizzle schemas, when needed
    shared/
      config/
      pipes/
  database/
    config.cjs
    migrations/
  package.json
  tsconfig.json
```

Each feature module imports `DatabaseModule` when needed. Repositories inject `DATABASE` from `src/modules/database/database.constants.ts`, typed as `Database` from `src/modules/database/services/database.service.ts`.

Define PostgreSQL tables in each module's `entities/` directory with Drizzle's `pgTable`. Drizzle's `vector` column type is available from `drizzle-orm/pg-core`; choose its dimensions when the embedding model is specified.

Schema changes require matching Sequelize migrations; Drizzle entity definitions do not create tables automatically. Generate a migration with `npm run migration:generate -- --name <name>`, then implement its `up` and `down` functions. Use `npm run migration:status` to inspect migrations or `npm run migration:undo` to revert the last one. The pgvector rollback refuses to remove the extension if database objects still depend on it.

## Checks and production

Run these commands from `api`:

```sh
npm run typecheck
npm run build
npm test
npm run start:prod
```

DTO classes use class-validator decorators and class-transformer annotations as needed. Global validation transforms DTOs and rejects properties without validation decorators. For schema-based input validation, use `new ZodValidationPipe(schema)` on the relevant route parameter.

`npm test` builds the API and runs extraction, chunking, URL validation, import failure, and HTTP endpoint tests. HTTP tests use an in-memory repository and embedding stub. Optional checks exercise the actual model and database:

```powershell
$env:RUN_MODEL_TESTS = '1'
$env:RUN_DATABASE_TESTS = '1'
$env:RUN_GEMINI_TESTS = '1'
npm test
```

Run migrations before the database integration check. It uses `DATABASE_URL` and rolls back its test records. The model check requires internet access on its first run and caches the downloaded model. The Gemini check makes a real API request and requires `GEMINI_API_KEY`; it can consume API quota. Omit a variable to skip its integration. The regular tests exercise question answering, provenance, citation validation, HTTP input validation, and upstream failures with a stubbed Gemini API.

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

Search uses cosine distance and returns `similarity = 1 - cosine_distance`, with the closest passages first. It always returns up to the requested number of neighbors, even for unrelated queries; similarity is not a calibrated confidence score. Queries above 254 MiniLM tokens are rejected rather than silently truncated. This is passage retrieval; chat answer generation is not implemented yet.

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
npm test
```

Run migrations before the database integration check. It uses `DATABASE_URL` and rolls back its test records. The model check requires internet access on its first run and caches the downloaded model. Omit either variable to skip that integration.

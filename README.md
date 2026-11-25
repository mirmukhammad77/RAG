# RAG

Repository for the RAG application, with separate backend and frontend directories.

```text
api/          # NestJS backend, database migrations, and backend configuration
frontend/     # React frontend, feature modules, and frontend configuration
package.json  # Convenience commands for working from the repository root
```

The applications keep their own dependencies, lockfiles, environment files, and build configuration. Install and run each application from its own directory, or use the root commands below.

## Backend

Install Node.js 22.13 or newer, then run from the repository root:

```sh
npm run setup:api
```

Copy `api/.env.example` to `api/.env` and set `DATABASE_URL`. Create the PostgreSQL database with pgvector available, then run:

```sh
npm run migration:run:api
npm run dev:api
```

For a local database with pgvector already installed, start Docker Desktop and run `docker compose up -d database`. This creates `rag` on port **5433**, keeping an existing PostgreSQL on 5432 available. Set `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/rag` in `api/.env`, then run migrations. The Compose credentials are for local development.

Root commands:

| Command | Purpose |
| --- | --- |
| `npm run setup:api` | Install the backend's locked dependencies |
| `npm run dev:api` | Start the backend in watch mode |
| `npm run build:api` | Build the backend |
| `npm run typecheck:api` | Check backend types |
| `npm test` | Build and test the backend |
| `npm run db:studio` | Open Drizzle Studio's local database connection |
| `npm run start:api` | Start the compiled backend |
| `npm run migration:run:api` | Run database migrations |
| `npm run migration:status:api` | Show migration status |

The backend accepts PDF uploads and direct PDF links without authentication, extracts page-aware passages, embeds them locally with MiniLM, and stores them in PostgreSQL with pgvector. It provides book browsing, semantic passage search, and Gemini answers with source citations through `POST /documents/ask`. Use `POST /documents/ask/stream` to receive textbook chunks immediately after retrieval and stream the AI answer as it arrives. Gemini failures preserve the retrieved chunks. MiniLM downloads on first use and is cached locally; no embedding API key is required. For answer generation, set `GEMINI_API_KEY` in `api/.env`; the default model is `gemini-3.1-flash-lite`. See the [question-answering setup and request example](api/README.md#gemini-question-answering).

The root `build` and `typecheck` commands currently target the API. See [api/README.md](api/README.md) for the API endpoints, data model, import limits, backend structure, and migration workflow.

To browse the database, run `npm run db:studio` and open [Drizzle Studio](https://local.drizzle.studio). Keep the command running while using Studio. It connects to the database configured in `api/.env`; start that database and run migrations first.

## Frontend

The [frontend](frontend/README.md) uses React with TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, and shadcn/ui. Its feature-based architecture provides a dark card-grid book library, per-book passage search, book details with extracted text in reading order, and a dialog for PDF uploads or direct PDF link imports. A separate Q&A page streams answers across all imported books with source citations and compact source references. No frontend tests or test tooling are included.

Use Node.js **22.22 or newer** for the frontend, then run from the repository root:

```sh
npm run setup:frontend
npm run dev:frontend
```

Start the configured database and run `npm run dev:api` in another terminal. The frontend calls `/api`, which Vite proxies to the backend on port 3000 by default. See [frontend configuration](frontend/README.md#development) for environment overrides and production proxy requirements.

| Command | Purpose |
| --- | --- |
| `npm run setup:frontend` | Install the frontend's locked dependencies |
| `npm run dev:frontend` | Start the Vite development server |
| `npm run build:frontend` | Check frontend types and build for production |
| `npm run typecheck:frontend` | Check frontend and Vite configuration types |
| `npm run preview:frontend` | Preview the production build locally |

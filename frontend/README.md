# RAG frontend

React and TypeScript frontend using Vite, Tailwind CSS, TanStack Query, React Router, and shadcn/ui. The dark book library provides a responsive card grid, book details with passage search and extracted text in reading order, and an Add book dialog for PDF uploads or direct PDF links. A separate Q&A page streams answers using passages retrieved from all books.

## Development

Use Node.js **22.22 or newer**. Run these commands from `frontend/`:

```sh
npm ci
npm run dev
```

Start the configured database and the [NestJS backend](../api/README.md), then open the local URL printed by Vite (normally `http://localhost:5173`). From the repository root, use `npm run dev:api` and `npm run dev:frontend` in separate terminals.

By default, the browser calls `/api`; Vite proxies those requests to `http://localhost:3000` and strips the `/api` prefix. This avoids cross-origin browser requests during local development. Copy `.env.example` to `.env` only if you need to change the defaults:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api` | Browser-visible API base URL or prefix |
| `API_PROXY_TARGET` | `http://localhost:3000` | Local Vite proxy target |

Restart Vite after changing these values. Never place secrets in variables prefixed with `VITE_`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server with hot reload |
| `npm run typecheck` | Check source and Vite configuration types |
| `npm run build` | Check types and create a production build in `dist/` |
| `npm run preview` | Serve the production build locally |

The repository root provides equivalent commands with a `:frontend` suffix. No frontend tests, test scripts, or test tooling are included.

## Feature-based architecture

```text
src/
  main.tsx                 # React entry point
  app/
    app.tsx                # Application composition
    providers.tsx          # TanStack Query client and React Router
    routes.tsx             # Route registration
    layout.tsx             # Shared navigation and page layout
    pages/                 # Not-found page
    styles.css             # Tailwind imports and shared dark tokens
  features/
    books/
      api/                 # Book list, details, passages, upload/link requests
      components/          # Cards, import dialog/form, pagination
      hooks/               # TanStack queries/mutation and URL pagination
      lib/                 # Book metadata formatting
      pages/               # Library and book details
      types.ts             # Backend response and import input types
    questions/
      api/                 # Streaming question requests across all books
      components/          # Question form, answer, and source references
      hooks/               # Streaming state and cancellation
      pages/               # Separate Q&A page
      types.ts             # Answer, fallback, and stream event types
  shared/
    api/                   # Fetch client, API errors, and SSE reader
    components/ui/         # shadcn/ui primitives
    lib/                   # Utilities shared across features
```

Keep a feature's components, API calls, query/mutation hooks, and types together under `src/features/<feature>/`. Add subdirectories only when needed. Register feature pages in `app/routes.tsx`. `shared/` holds reusable code without business-specific behavior and must not depend on features; `app/` composes features and shared code.

The `@/` alias resolves to `src/` in TypeScript and Vite. A single QueryClient is provided at the application root. Book reads use query cancellation and show explicit loading, empty, error, and retry states. Imports use a mutation without automatic retries, because resubmitting can create duplicate books. A successful import invalidates library queries and returns the library to its first page.

## Book library and imports

- `/` shows books newest first in a card grid, 20 per page.
- `/books/:bookId` shows metadata and extracted passages in the order returned by the backend, 20 passages per page. Each passage retains its original PDF page range and headings. Passages may overlap; this is extracted text, not a PDF viewer.
- Search this book submits to `POST /documents/search` with the opened book's `document_id`. It displays up to five passages, ordered by semantic similarity, with original PDF page ranges and headings. Search is separate from the reading-order pagination; Clear search removes the results. Similarity does not establish whether a passage answers the query. Queries must be nonempty, at most 2,000 characters, and fit within the backend's 254-token limit. Search errors are shown without automatic retries.
- Both views keep pagination in `?page=2`, etc. The API does not return totals, so the frontend requests one additional record to determine whether Next is available.
- Add book opens a native modal dialog with keyboard focus containment, an accessible title, and shared Button/Input primitives. Closing is disabled while an import is in progress.
- Imports require a title and accept an optional edition. Uploads are limited to one nonempty PDF up to 50 MiB. URL imports need a direct public HTTP/HTTPS PDF link without credentials. The backend also enforces 2,000 pages and rejects PDFs without extractable text.
- Importing waits for extraction and indexing to finish; large books or the first model download can take several minutes. There is no simulated progress percentage. The original uploaded PDF is not retained by the backend.
- If an import response is interrupted, check the library before resubmitting. The server may have completed the import even if the browser did not receive confirmation.

## Streaming Q&A

Open Q&A in the main navigation (`/questions`). Questions search across all imported books: the frontend sends only `question` to `POST /documents/ask/stream`, without a `document_id` filter, and uses the backend's default of five passages. Each question is independent; this page does not store conversation history or send previous questions as context.

The page appends answer text while generation runs. A completed answer replaces provisional text with the backend's validated answer. Numbered citations link to compact source references with book title, edition, headings, and physical PDF pages. Book titles link to book details. The Q&A page does not display retrieved passages; passage search remains available inside each book.

If Gemini fails, the page replaces provisional text with the backend's extractive fallback or unavailable-answer message. Fallbacks are labeled as textbook excerpts when applicable. A stopped or interrupted stream labels any partial answer as incomplete. Stop and navigation away cancel the request. The frontend does not automatically retry questions; submitting again starts a fresh request.

Questions must be nonempty, at most 2,000 characters, and fit within the backend's 254-token limit. Configure `GEMINI_API_KEY` on the backend for answers. Configuration and validation errors before streaming appear on the page; secrets stay on the server. Production proxies must allow incremental SSE responses and a long enough timeout for generation, in addition to supporting book imports.

## UI

Tailwind CSS uses its Vite plugin. Dark colors are defined in `src/app/styles.css`; the document has a permanent `dark` class, with no theme switcher or theme provider.

shadcn/ui is configured in `components.json` with neutral colors and shared component aliases. Shared primitives include Button, Input, and the `cn` utility, following the [Vite installation guide](https://ui.shadcn.com/docs/installation/vite). Add components from this directory when needed:

```sh
npx shadcn@latest add <component-name>
```

Generated UI components belong in `src/shared/components/ui/`. Keep feature-specific UI inside its feature.

## Production hosting

Build with `npm run build` and serve `dist/` as static files. React Router uses browser history, so the production host must serve `index.html` for application routes that do not match a static file. `npm run preview` is for local build preview, not a production server.

The Vite API proxy is a local development/preview convenience and is not included in the static build. For production, configure your host to proxy `/api/*` to the backend with `/api` removed, before the SPA fallback. Alternatively, set `VITE_API_BASE_URL` to the deployed backend URL before building and configure that backend's CORS policy for your frontend origin. The current backend does not enable cross-origin requests. Give the production proxy enough time for synchronous imports to finish.

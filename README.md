# RAG

Repository for the RAG application, with separate backend and frontend directories.

```text
api/          # NestJS backend, database migrations, and backend configuration
frontend/     # Reserved for the frontend application
package.json  # Convenience commands for working from the repository root
```

The applications keep their own dependencies, lockfiles, environment files, and build configuration. Install and run each application from its own directory, or use the root commands below for the API.

## Backend

Install Node.js 22 or newer, then run from the repository root:

```sh
npm run setup:api
```

Copy `api/.env.example` to `api/.env` and set `DATABASE_URL`. Create the PostgreSQL database with pgvector available, then run:

```sh
npm run migration:run:api
npm run dev:api
```

Root commands:

| Command | Purpose |
| --- | --- |
| `npm run setup:api` | Install the backend's locked dependencies |
| `npm run dev:api` | Start the backend in watch mode |
| `npm run build:api` | Build the backend |
| `npm run typecheck:api` | Check backend types |
| `npm run start:api` | Start the compiled backend |
| `npm run migration:run:api` | Run database migrations |
| `npm run migration:status:api` | Show migration status |

The root `build` and `typecheck` commands currently target the API. See [api/README.md](api/README.md) for the backend structure, migration workflow, and additional commands.

## Frontend

The [frontend directory](frontend/README.md) is reserved for the frontend application. Its framework and tooling have not been selected yet. Add its package manifest, lockfile, configuration, and environment example inside `frontend/` when implementation begins.

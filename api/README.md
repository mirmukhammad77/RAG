# RAG backend

NestJS and TypeScript backend using PostgreSQL, Drizzle for entity definitions and queries, and Sequelize CLI for migrations. DTO validation uses class-validator and class-transformer. Zod validates environment configuration and is available through `ZodValidationPipe`.

## Setup

Run the commands in this document from the `api` directory.

1. Install Node.js 22 or newer and run `npm ci`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`.
3. Create the PostgreSQL database. The server must have pgvector installed and the migration user must have permission to enable it.
4. Run `npm run migration:run` to enable the vector extension.
5. Run `npm run start:dev`.

The application checks the database connection during startup. No application endpoints or domain tables have been added.

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
npm run start:prod
```

DTO classes use class-validator decorators and class-transformer annotations as needed. Global validation transforms DTOs and rejects properties without validation decorators. For schema-based input validation, use `new ZodValidationPipe(schema)` on the relevant route parameter.

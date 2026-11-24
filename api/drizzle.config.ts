import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required. Configure it in api/.env before starting Drizzle Studio.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/**/entities/*.ts',
  dbCredentials: { url: databaseUrl },
});

import { z } from 'zod';

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MODEL_CACHE_DIR: z.string().min(1).default('.cache/models'),
  GEMINI_API_KEY: z.string().trim().optional(),
  GEMINI_MODEL: z.string().trim().regex(/^gemini-[a-z0-9.-]+$/).default('gemini-3.1-flash-lite'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  GEMINI_STREAM_MAX_MS: z.coerce.number().int().min(1000).max(300_000).default(120_000),
  DATABASE_URL: z.url().refine(
    (value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
    'DATABASE_URL must use the postgres or postgresql protocol',
  ),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(config: Record<string, unknown>): Environment {
  return environmentSchema.parse(config);
}

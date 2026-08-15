import { z } from 'zod';

const envSchema = z.object({
  // Personal Access Token for the `devsix` Mattermost bot account.
  MATTERMOST_MCP_TOKEN: z.string().min(1, 'MATTERMOST_MCP_TOKEN is required (bot PAT)'),
  MATTERMOST_URL: z.string().url().default('https://mattermost.jon23d.cc'),
  OPERATOR_EMAIL: z.string().email().default('jon23d@gmail.com'),
  STATE_FILE_PATH: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate process.env at startup. Throws a single error listing every
 * problem found -- the daemon must never limp along on partial/invalid
 * config, since a config bug here is exactly the kind of "looks alive but
 * isn't" failure this ticket exists to prevent.
 */
export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${lines}`);
  }
  return result.data;
}

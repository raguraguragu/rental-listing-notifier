import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ATBB_USERNAME: z.string().min(1),
  ATBB_PASSWORD: z.string().min(1),
  ATBB_SOURCE_MODE: z.enum(['fixture', 'browser']).default('fixture'),
  ATBB_FIXTURE_PATH: z.string().default('data/sample-listings.json'),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1)
});

export type AppConfig = z.infer<typeof envSchema>;

export function requireBrowserAtbbConfig(_config: AppConfig): void {
  // ATBB_USERNAME and ATBB_PASSWORD are already required by the schema
}

export function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`環境変数が不足しています。GitHub Secretsまたは.envを確認してください。\n${issues.join('\n')}`);
  }

  return result.data;
}
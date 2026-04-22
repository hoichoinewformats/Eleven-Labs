import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  PORT: Number(optional('PORT', '4000')),
  HOST: optional('HOST', '0.0.0.0'),
  NODE_ENV: optional('NODE_ENV', 'development'),
  CORS_ORIGIN: optional('CORS_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  DATABASE_URL: required('DATABASE_URL'),

  REDIS_URL: optional('REDIS_URL', 'redis://localhost:6379'),
  WORKER_MODE: (optional('WORKER_MODE', 'queue') as 'queue' | 'inline'),

  JWT_SECRET: required('JWT_SECRET'),
  JWT_EXPIRES_IN: optional('JWT_EXPIRES_IN', '7d'),

  ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
  CLAUDE_MODEL: optional('CLAUDE_MODEL', 'claude-sonnet-4-6'),

  ELEVENLABS_API_KEY: required('ELEVENLABS_API_KEY'),

  UPLOAD_DIR: optional('UPLOAD_DIR', './uploads'),
  MAX_UPLOAD_MB: Number(optional('MAX_UPLOAD_MB', '25')),
};

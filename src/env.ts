import 'dotenv/config';
import { loadOrCreateJwtSecret } from './auth/jwt-secret.js';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

// Three required vars only. Everything else has sane defaults.
export const env = {
  // Required
  DATABASE_URL: required('DATABASE_URL'),
  OPENROUTER_API_KEY: required('OPENROUTER_API_KEY'),
  ELEVENLABS_API_KEY: required('ELEVENLABS_API_KEY'),

  // Sensible defaults
  PORT: Number(optional('PORT', '4000')),
  HOST: optional('HOST', '0.0.0.0'),
  CORS_ORIGIN: optional('CORS_ORIGIN', '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Free OpenRouter model by default; override per project. Examples:
  //   anthropic/claude-sonnet-4.6   (paid, best for nuanced JSON)
  //   openai/gpt-4o                  (paid)
  //   google/gemini-2.0-flash-exp:free
  //   meta-llama/llama-3.3-70b-instruct:free
  OPENROUTER_MODEL: optional('OPENROUTER_MODEL', 'nvidia/nemotron-3-super-120b-a12b:free'),

  // Auto-generated, persisted to .jwt-secret (gitignored)
  JWT_SECRET: loadOrCreateJwtSecret(),
  JWT_EXPIRES_IN: optional('JWT_EXPIRES_IN', '7d'),

  UPLOAD_DIR: optional('UPLOAD_DIR', './uploads'),
  MAX_UPLOAD_MB: Number(optional('MAX_UPLOAD_MB', '25')),

  NODE_ENV: optional('NODE_ENV', 'development'),
};

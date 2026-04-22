import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Read or generate the JWT signing secret. Stored in a `.jwt-secret` file
 * at the project root with mode 0600. This avoids one more env var.
 *
 * Trade-off: deleting the file invalidates every existing session. Fine
 * for solo / small-team workspaces.
 */
export function loadOrCreateJwtSecret(): string {
  const file = path.resolve(process.cwd(), '.jwt-secret');
  if (fs.existsSync(file)) {
    const v = fs.readFileSync(file, 'utf8').trim();
    if (v.length >= 32) return v;
  }
  const fresh = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, fresh, { mode: 0o600 });
  return fresh;
}

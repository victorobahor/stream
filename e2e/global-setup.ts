import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseURL = process.env.BASE_URL ?? 'https://stream.vicktalk.online';
const flagPath = path.join(__dirname, '.reachable');

export default async function globalSetup(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  let reachable = false;
  try {
    const res = await fetch(baseURL, { signal: controller.signal });
    reachable = res.ok;
    if (!reachable) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      `\n[e2e] Skipping live tests — cannot reach ${baseURL} (${reason}).\n` +
        '      Run against a reachable host: BASE_URL=http://localhost:8080 npm run test:e2e\n',
    );
  } finally {
    clearTimeout(timer);
    fs.writeFileSync(flagPath, reachable ? '1' : '0', 'utf8');
  }
}

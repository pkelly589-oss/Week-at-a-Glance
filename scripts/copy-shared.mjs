// Copies the shared week rules (public/lib) into functions/shared, because
// Firebase deploys the functions folder on its own. Runs before deploys,
// tests and the local emulators; functions/shared is not committed.
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(`${root}functions/shared`, { recursive: true });
for (const f of ['week.js', 'view.js']) cpSync(`${root}public/lib/${f}`, `${root}functions/shared/${f}`);

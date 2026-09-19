import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../lib/db';
import { seedDatabase } from '../lib/seed';

const dbPath = process.env.FOUNDER_OS_DB ?? path.join(process.cwd(), 'data', 'founder-os.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = await openDb(dbPath);
await seedDatabase(db);
console.log(`Seeded ${dbPath}`);
console.log(`  departments: ${(await db.departments.all()).length}`);
console.log(`  agents:      ${(await db.agents.all()).length}`);
console.log(`  tools:       ${(await db.tools.all()).length}`);
console.log(`  roadmap:     ${(await db.roadmap.all()).length}`);
await db.close();

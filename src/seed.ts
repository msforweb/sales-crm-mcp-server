import { loadConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import { CrmRepository } from "./db/repository.js";
import { createDemoSeed } from "./db/seed-demo.js";

const config = loadConfig();
if (config.mode !== "demo" || !config.demoEnabled) {
  throw new Error("Database seeding is only available in explicitly enabled demo mode.");
}

const db = openDatabase(config.databasePath);
try {
  const seeded = new CrmRepository(db).seedDemo("synthetic-demo", createDemoSeed());
  console.log(seeded ? "Seeded 15 synthetic demo leads." : "Demo data already exists; no records changed.");
} finally {
  db.close();
}
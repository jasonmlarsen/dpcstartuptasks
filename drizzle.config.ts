import { defineConfig } from "drizzle-kit";

import { databasePath } from "./app/database/database-path";

export default defineConfig({
  dialect: "sqlite",
  schema: "./app/database/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databasePath() },
});

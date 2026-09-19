import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * The row `/health` reads.
 *
 * The health check has to prove that the SQLite file is present, readable and
 * migrated, and it has to keep proving the same thing once the Task Library
 * and every Practice table arrive. Pointing it at a domain table would tie an
 * uptime monitor to the data model and make the check's meaning move whenever
 * the model did. This table exists for the monitor and for nothing else: one
 * row, written by the initial migration, never written again.
 */
export const healthCheck = sqliteTable("health_check", {
  id: integer("id").primaryKey(),
  /** The string the uptime monitor greps the response for. */
  keyword: text("keyword").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** The single row's primary key, and the only one the check ever asks for. */
export const HEALTH_CHECK_ROW_ID = 1;

/**
 * A Phase: an ordered grouping of Tasks.
 *
 * Its number is derived from `position` and is never part of `name` — the
 * cleaned CSV strips the `Phase N: ` prefix for exactly this reason, so that
 * reordering the rail is a `position` edit and not eleven renames.
 */
export const phase = sqliteTable("phase", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  position: integer("position").notNull(),
});

/**
 * A Global Task: a Task belonging to the Task Library.
 *
 * Separate from `custom_task` (ADR-0003), so a query against this table cannot
 * leak a Practice's work — there is none in it.
 */
export const globalTask = sqliteTable("global_task", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Derived from the title at Seed and frozen forever. Never edited. */
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  phaseId: integer("phase_id")
    .notNull()
    .references(() => phase.id),
  /** Markdown. Since no other descriptive field survives, the Body is the Task. */
  body: text("body").notNull(),
  stateSpecific: integer("state_specific", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Order within the Phase. */
  position: integer("position").notNull(),
  /** Null means Draft: no Practice has a Task Entry for it. A Seed always sets it. */
  publishedAt: integer("published_at", { mode: "timestamp" }),
});

/**
 * A Helpful Link: a curated, labelled link on a Global Task.
 *
 * `label` is `notNull` because a bare URL is a bug, and the Seed refuses a
 * blank one rather than deriving anything.
 */
export const helpfulLink = sqliteTable("helpful_link", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  globalTaskId: integer("global_task_id")
    .notNull()
    .references(() => globalTask.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  url: text("url").notNull(),
  /** Render order, which is editorial and so is stored rather than derived. */
  position: integer("position").notNull(),
});

/**
 * A Dependency: one Task usually comes after another. Advice, never
 * enforcement — nothing in the product is ever locked, so nothing reads this
 * to decide what a physician may do.
 */
export const taskDependency = sqliteTable(
  "task_dependency",
  {
    globalTaskId: integer("global_task_id")
      .notNull()
      .references(() => globalTask.id, { onDelete: "cascade" }),
    dependsOnTaskId: integer("depends_on_task_id")
      .notNull()
      .references(() => globalTask.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.globalTaskId, table.dependsOnTaskId] })],
);

/**
 * Better Auth's four tables, spelled in Drizzle.
 *
 * The property names are Better Auth's field names and cannot be renamed — its
 * Drizzle adapter looks each column up as `schema[model][fieldName]`. The
 * column names underneath are ours, in the snake_case the rest of this file
 * uses. Only `app/auth/server.ts` ever reads or writes these tables
 * (ADR-0004); nothing else in the app should import them.
 */
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  /** Better Auth requires this column; v1 has no name on it until an Invite. */
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  /** The value in the cookie. Never cached (ADR-0004): every request reads it. */
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/**
 * Unused by the product and required by the library: there is no password and
 * no social provider, so nothing writes a row here. It exists because Better
 * Auth's internal adapter expects the table.
 */
export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/**
 * Where an unspent Sign-in Link lives.
 *
 * `identifier` holds the SHA-256 of the token, never the token itself
 * (`storeToken: "hashed"`, ADR-0004), so a stolen copy of the database is not
 * a drawer full of working links. The row is consumed atomically on Continue.
 */
export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  // Every Continue press looks a row up by `identifier` and by nothing else.
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/**
 * One row per Sign-in Link we were asked to send, for the per-address axis of
 * our own rate limiting (ADR-0004): 3 per 15 minutes, 10 per rolling 24 hours.
 *
 * The address is stored as a SHA-256 digest and never in the clear. Counting
 * is all this axis needs, and anyone at all can put an address into this table
 * by typing it into the sign-in form — so it holds no list of who was asked
 * about. Rows older than the long window are pruned as they are counted.
 */
export const signInLinkRequest = sqliteTable(
  "sign_in_link_request",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** SHA-256 of the lowercased, trimmed address. */
    emailDigest: text("email_digest").notNull(),
    requestedAt: integer("requested_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("sign_in_link_request_digest_idx").on(
      table.emailDigest,
      table.requestedAt,
    ),
  ],
);

/**
 * One row per Continue press, for the per-IP axis: roughly 20 per 10 minutes,
 * and visible when it trips, because the token holder already proved
 * possession and there is nothing to enumerate on this leg (ADR-0004).
 */
export const continueAttempt = sqliteTable(
  "continue_attempt",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** The derived client IP. Never null: a request with no derivable IP is refused. */
    ipAddress: text("ip_address").notNull(),
    attemptedAt: integer("attempted_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("continue_attempt_ip_idx").on(table.ipAddress, table.attemptedAt),
  ],
);

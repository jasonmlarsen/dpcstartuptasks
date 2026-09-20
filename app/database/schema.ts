import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
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
  /**
   * Null means live. Set means Retired: withdrawn from the Task Library, and
   * never deleted, because Practices have Task Entries against it and may
   * already have done the work.
   *
   * Nullable rather than a state column so that un-retiring is the same
   * backfill as publishing, which is what makes retire-and-replace a safe
   * editing move. The Admin's act of Retiring — which hard-deletes the
   * Entries of Practices that did nothing with it — belongs to the admin
   * panel; what this column drives here is the reading: a Practice that kept
   * its Entry still sees the Task, labelled `No longer required`.
   */
  retiredAt: integer("retired_at", { mode: "timestamp" }),
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
 *
 * With one carve-out, named here rather than discovered: the two Email Consent
 * columns on `user` are **ours**, not Better Auth's, and `app/consent` writes
 * them. They live on this table because a User is who consented and there is
 * nothing else for them to hang off — which is a fact about the data model and
 * not a crack in the module boundary. The boundary is about the library: no
 * file outside `app/auth/server.ts` imports `better-auth`, and
 * `test/auth-module.test.ts` is what keeps that true.
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

  /**
   * Email Consent, which is an act and never a state: when it was granted and
   * which Consent Wording was agreed to. Null means it was never granted —
   * everyone is asked exactly once, at registration, so null is unambiguous.
   *
   * There is deliberately no `email_consent_revoked_at`. Consent is
   * append-only: unsubscribing happens in Kit, through the footer of an email,
   * and a revocation column here would only rot out of sync with the place
   * that actually knows. These two columns live on `user` rather than in the
   * auth module's world, but Better Auth owns the table, so they are declared
   * here with the rest of it.
   */
  emailConsentGrantedAt: integer("email_consent_granted_at", {
    mode: "timestamp",
  }),
  emailConsentVersion: text("email_consent_version"),

  /**
   * The four columns Better Auth's `admin` plugin declares on this table.
   *
   * `role` is the whole of the admin panel's guard, and it is deliberately
   * write-only from outside the app: promotion to Admin is a SQL statement
   * run on the VPS (`docs/runbooks/admin-access.md`), never a screen, so
   * there is no endpoint to attack and nothing to get wrong twice. Null and
   * `user` both mean *not the Admin*; the plugin writes `user` onto every
   * User it creates.
   *
   * The three ban columns have no reader and no writer in this product —
   * nobody is ever banned, and there is no screen that could do it. They are
   * here because the plugin's own session hook reads `banned` on every sign
   * in, so a table without them is a table the library cannot query. Declared
   * rather than used, and that is the whole of their story.
   */
  role: text("role"),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp" }),
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

  /**
   * Set on the borrowed session Support View creates, naming the Admin who
   * is looking (ADR-0001). Nothing reads it yet — Support View is #40 — and
   * it is here now because it is the other half of the same plugin schema as
   * the four columns on `user`, and a table the library declares a field on
   * is a table that should have it.
   */
  impersonatedBy: text("impersonated_by"),
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

/**
 * The fifty states and DC, which is the whole of what the Tailoring Wizard's
 * state question accepts.
 *
 * A closed list rather than a free-text box, and spelled out in full rather
 * than as two-letter codes, because this is the one part of the Practice
 * Profile with a reader: `Varies by state — check Ohio's rules` is a sentence
 * a physician reads, and `OH`, `Ohio` and `ohio` in one column would make it
 * three sentences.
 */
export const PRACTICE_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
  "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota",
  "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
] as const;

export type PracticeState = (typeof PRACTICE_STATES)[number];

/**
 * A Practice: one clinic and its shared task list, and the unit of tenancy.
 *
 * It has no name when it is created, because registration asks for nothing but
 * an email address — the Owner names it later from settings, and a Practice
 * that was never named is not a broken one.
 */
export const practice = sqliteTable("practice", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Null until the Owner names it. Never shown as a blank line. */
  name: text("name"),

  /**
   * The Practice Profile: what the Practice told the Tailoring Wizard.
   *
   * Kept after the Wizard has set its Statuses, for wording and for
   * segmenting email — never re-applied to Tasks published later (ADR-0002).
   * Null on all three means the question was never answered, either because
   * the Wizard was skipped or because the physician left one blank, and that
   * is not a broken Practice: the Wizard is optional the whole way down.
   *
   * `state` is the only one with a live reader — it turns the journey map's
   * quiet `Varies by state` pill into a pointer at a particular state's
   * rules. The two booleans are stored and nothing displays them.
   */
  state: text("state", { enum: PRACTICE_STATES }),
  /** False means mobile or house-call: the eight fixed-office Tasks do not apply. */
  fixedLocation: integer("fixed_location", { mode: "boolean" }),
  /** False means no hire inside six months: the six employment Tasks do not apply. */
  expectsEmployees: integer("expects_employees", { mode: "boolean" }),
  /**
   * When the Tailoring Wizard stopped being owed — set by Continue and by
   * Skip alike, because a skip is an answer and closing the tab is not.
   *
   * On the Practice and never on the User (ADR-0002): with no provenance
   * there is no undo, so a Member accepting an Invite in month three must
   * never be handed a screen that can mass-set Not Applicable across the
   * Owner's work.
   */
  tailoringSettledAt: integer("tailoring_settled_at", { mode: "timestamp" }),

  /**
   * Null means live. Set is the Grace Period: the Owner has deleted this
   * Practice, everyone in it is locked out, and **nothing has been
   * destroyed**. The Purge at day 30 is what destroys it (ADR-0007), and
   * this column is the only thing standing between the two.
   *
   * A column rather than a delete because the confirmation the Owner read
   * promises thirty days, and in v1 honouring that promise is the operator
   * clearing this timestamp by hand — a named gap, documented in the
   * restore runbook, and the reason every screen behind the door goes
   * dark: `practiceFor` will not return a Practice with this column set,
   * so no page has to remember to check. The two reads that look past it
   * are named where they live — `practiceIsLive`, for the invite link,
   * which is the one way into a Practice that does not start from a
   * Membership, and `hasDeletedPractice`, which only chooses a paragraph.
   */
  deletedAt: integer("deleted_at", { mode: "timestamp" }),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * A Membership: the link between a User and the one Practice they belong to.
 *
 * `user_id` is UNIQUE, and that index is the whole of *one Practice per User*
 * — going multi-practice later is dropping it. A partial unique index keeps
 * exactly one Owner per Practice, because `role` is the only thing separating
 * the member who can delete everything from the two who cannot.
 */
export const membership = sqliteTable(
  "membership",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    practiceId: integer("practice_id")
      .notNull()
      .references(() => practice.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("membership_practice_idx").on(table.practiceId),
    uniqueIndex("membership_one_owner_idx")
      .on(table.practiceId)
      .where(sql`${table.role} = 'owner'`),
  ],
);

/**
 * How many people a Practice may hold, counting the Owner and every pending
 * Invite.
 *
 * Three is the product's shape rather than a tuning knob: an Owner, and the
 * two people a solo practice actually shares this list with — the spouse
 * doing the paperwork and the practice manager. Pending Invites count, which
 * is what makes acceptance unable to put a fourth person in a Practice
 * without anything having to be locked at the moment someone says yes.
 */
export const PRACTICE_PEOPLE_CAP = 3;

/**
 * An Invite: an Owner's outstanding offer of a Membership to an email address.
 *
 * `token_digest` holds the SHA-256 of the invite token and never the token
 * itself, for the same reason the `verification` table does: a stolen copy of
 * the database is not a drawer full of working invitations.
 *
 * The address is stored in the clear, unlike `sign_in_link_request` and
 * `pending_email_consent`. The difference is who put it there: those two are
 * filled by anyone who can type into the sign-in form, while this row is one
 * Owner naming a person they are inviting into their own Practice, and the
 * Owner has to be shown it back on the People section to be able to revoke it.
 *
 * Pending is `accepted_at IS NULL AND revoked_at IS NULL AND expires_at` in
 * the future — three columns rather than a state, because each of the first
 * two is a different sentence the invite link has to be able to say, and a
 * single `status` column would collapse them into one.
 */
export const invite = sqliteTable(
  "invite",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    practiceId: integer("practice_id")
      .notNull()
      .references(() => practice.id, { onDelete: "cascade" }),
    /** The address the Owner typed, lowercased and trimmed. */
    email: text("email").notNull(),
    /** SHA-256 of the token in the invite email. Unique, so a lookup is a hit or nothing. */
    tokenDigest: text("token_digest").notNull().unique(),
    /**
     * The name the invitee typed on the acceptance screen, waiting for the
     * User that their first sign-in will create — the same gap
     * `pending_email_consent` crosses, for the same reason. Null until they
     * fill it in, because the acceptance screen may never be reached.
     */
    inviteeName: text("invitee_name"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    /** Set when the invitee signed in and the Membership was created. */
    acceptedAt: integer("accepted_at", { mode: "timestamp" }),
    /** Set when the Owner took the offer back. */
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("invite_practice_idx").on(table.practiceId),
    // Every sign-in asks whether the address arriving has an Invite waiting.
    index("invite_email_idx").on(table.email),
  ],
);

/** Where a Practice has got to on one Task. Stored as text, never as `N/A`. */
export const TASK_STATUSES = [
  "not_started",
  "in_progress",
  "done",
  "not_applicable",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];



/**
 * A Custom Task: a Task a Practice created for itself.
 *
 * Separate from `global_task` (ADR-0003) and deliberately lighter: no Helpful
 * Links, no Dependencies, no state flag — those are editorial acts, and a
 * physician is not an editor. It carries its own Status rather than a Task
 * Entry, because it already belongs to exactly one Practice.
 *
 * No `position`: within a Phase, Custom Tasks order by `created_at` behind the
 * Global Tasks, since a manual order cannot coexist with live auto-sort.
 */
export const customTask = sqliteTable(
  "custom_task",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    practiceId: integer("practice_id")
      .notNull()
      .references(() => practice.id, { onDelete: "cascade" }),
    phaseId: integer("phase_id")
      .notNull()
      .references(() => phase.id),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("not_started"),
    /**
     * The same two fields a Task Entry carries, for the same reason: a
     * Practice's writing and its deadline belong on the Task, whoever
     * wrote the Task. They are columns here rather than a shared table
     * because a Custom Task already belongs to exactly one Practice
     * (ADR-0003), so there is nothing for a join to establish.
     */
    note: text("note"),
    targetDate: integer("target_date", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index("custom_task_practice_idx").on(table.practiceId)],
);

/**
 * A Task Entry: a Practice's row for one Global Task.
 *
 * Eager (ADR-0003). One row per Published Global Task exists from the moment
 * the Practice is created, so the absence of an Entry never means anything and
 * code defending against a missing one is a symptom of a backfill bug.
 *
 * `announced_at` is written only when an Entry is created for a Practice that
 * already existed — Tasks present at creation are never Newly Added, which is
 * why a brand-new Practice does not open to ninety-eight New pills.
 */
export const taskEntry = sqliteTable(
  "task_entry",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    practiceId: integer("practice_id")
      .notNull()
      .references(() => practice.id, { onDelete: "cascade" }),
    globalTaskId: integer("global_task_id")
      .notNull()
      .references(() => globalTask.id),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("not_started"),
    /** The Practice's own writing, belonging to the Practice and not its author. */
    note: text("note"),
    targetDate: integer("target_date", { mode: "timestamp" }),
    /** Newly Added is `announced_at IS NOT NULL AND acknowledged_at IS NULL`. */
    announcedAt: integer("announced_at", { mode: "timestamp" }),
    acknowledgedAt: integer("acknowledged_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("task_entry_practice_task_idx").on(
      table.practiceId,
      table.globalTaskId,
    ),
  ],
);

/**
 * An Email Consent granted on the registration form, waiting for the account
 * it belongs to.
 *
 * The registration form *is* the sign-in form, and at the moment it is posted
 * there is no User to write the consent onto — the User arrives when Continue
 * is pressed, possibly on another device. This table carries the act across
 * that gap and nothing else: the row is consumed when the User is first
 * created, and a row older than a Sign-in Link is ignored and dropped.
 *
 * The address is a SHA-256 digest, for the same reason as
 * `sign_in_link_request`: anyone at all can type an address into that form, so
 * neither table may become a record of who was asked about. Nothing reads
 * either one to decide what to answer a visitor.
 */
export const pendingEmailConsent = sqliteTable(
  "pending_email_consent",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** SHA-256 of the lowercased, trimmed address. */
    emailDigest: text("email_digest").notNull(),
    /** The Consent Wording agreed to, which is never rewritten in place. */
    version: text("version").notNull(),
    /** The moment the box was submitted, carried onto the User unchanged. */
    grantedAt: integer("granted_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("pending_email_consent_digest_idx").on(table.emailDigest),
  ],
);

/**
 * How long one Feedback may be, and how many a User may send in an hour.
 *
 * The one free-text box in the product, so it is the one place with a
 * ceiling — and unlike the auth library's limiter (ADR-0004), this one
 * actually fires, because every Feedback goes through an action we wrote.
 * Neither number is a tuning knob a physician will ever meet: 5,000
 * characters is several times the longest complaint anyone types about a
 * paragraph of guidance, and ten in an hour is more than a person reporting
 * real problems reaches.
 */
export const FEEDBACK_CHARACTER_CAP = 5000;
export const FEEDBACK_PER_HOUR = 10;

/**
 * A Feedback: one thing a physician told the Admin was wrong.
 *
 * A message, not a case. There is **no `kind` column**, here or anywhere: a
 * dropdown is friction at the moment of typing, and an Admin-applied tag
 * would be a taxonomy for an audience of one. What sorts these rows is the
 * page they came from and the Task they are about, and grouping by Task is
 * the query that matters.
 *
 * Two states and nothing around them: New while `done_at` is null, then
 * Done, optionally with the one line recording what changed or why nothing
 * did. A nullable timestamp rather than a status column, for the reason
 * `retired_at` and `deleted_at` are: the state *is* the fact of the moment,
 * and there is no third value for a column to hold. The Admin's side of
 * this — the queue, the Done press, the digest — is a later ticket; a row
 * is created New and nothing here writes the other state yet.
 *
 * Both foreign keys cascade, which is how Purge takes Feedback (ADR-0007).
 * Sever-and-keep was rejected: free text names its own author, so a row
 * stripped of its FKs would be de-identified only in the schema.
 */
export const feedback = sqliteTable(
  "feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    practiceId: integer("practice_id")
      .notNull()
      .references(() => practice.id, { onDelete: "cascade" }),
    /**
     * Who typed it — the address the Admin writes back to by hand, or not at
     * all.
     *
     * Null once that person's account is gone: a Member who Leaves, or one
     * the Owner removes, is deleted immediately, and neither act may take a
     * Feedback with it. **Only a Purge destroys a Feedback**, and a Purge
     * reaches this row through `practice_id` rather than through here.
     *
     * This is not the sever-and-keep ADR-0007 rejected. That proposal kept
     * rows after their Practice was destroyed and called them anonymous;
     * this row still belongs to a live Practice, is still readable as that
     * Practice's, and is still destroyed whole when that Practice is purged.
     * What is lost is only the reply address, and only because the person
     * it belonged to asked for their account to be gone.
     */
    authorUserId: text("author_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    text: text("text").notNull(),
    /**
     * Where they were, as a path a person can read and paste into a browser
     * — `/tasks/foundation-planning?task=obtain-ein`, never a route name.
     * The Admin reading this has to be able to go and look.
     */
    pagePath: text("page_path").notNull(),
    /**
     * The Global Task they were looking at, when they were looking at one.
     * Null covers three cases that need no telling apart: no Task open, a
     * Custom Task, and a ref that named nothing.
     */
    globalTaskId: integer("global_task_id").references(() => globalTask.id),
    /**
     * The Task's title as it read at the moment the Feedback was sent.
     *
     * A snapshot and not a join, because the two Tasks this has to name
     * cannot both be reached by one: a Custom Task is hard-deleted and
     * leaves nothing to point at, and a Global Task's title is the Admin's
     * to edit — often as the very fix this Feedback asked for. Either way
     * the row still says what the physician was reading.
     */
    taskTitle: text("task_title"),
    /** Null is New. Set is Done, which is the Admin's act and a later ticket. */
    doneAt: integer("done_at", { mode: "timestamp" }),
    /** The one line on Done: what changed, or why nothing did. */
    doneNote: text("done_note"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    // The queue reads New first and newest first; the hourly ceiling counts
    // one author's last hour. Two indexes, one per reader.
    index("feedback_done_idx").on(table.doneAt, table.createdAt),
    index("feedback_author_idx").on(table.authorUserId, table.createdAt),
  ],
);

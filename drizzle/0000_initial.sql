CREATE TABLE `health_check` (
	`id` integer PRIMARY KEY NOT NULL,
	`keyword` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
-- Hand-added, and `drizzle-kit generate` will not reproduce it: the generator
-- writes schema, not content. The health check has nothing to read without it.
INSERT INTO `health_check` (`id`, `keyword`) VALUES (1, 'LAUNCH_TASKS_OK');

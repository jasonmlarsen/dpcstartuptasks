CREATE TABLE `impersonation_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`admin_user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`practice_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`ended_at` integer,
	`ended_reason` text
);
--> statement-breakpoint
CREATE INDEX `impersonation_log_target_idx` ON `impersonation_log` (`target_user_id`,`ended_at`);--> statement-breakpoint
CREATE INDEX `impersonation_log_admin_idx` ON `impersonation_log` (`admin_user_id`,`started_at`);
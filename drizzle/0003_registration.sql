CREATE TABLE `custom_task` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`practice_id` integer NOT NULL,
	`phase_id` integer NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`phase_id`) REFERENCES `phase`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `custom_task_practice_idx` ON `custom_task` (`practice_id`);--> statement-breakpoint
CREATE TABLE `membership` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`practice_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_user_id_unique` ON `membership` (`user_id`);--> statement-breakpoint
CREATE INDEX `membership_practice_idx` ON `membership` (`practice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `membership_one_owner_idx` ON `membership` (`practice_id`) WHERE "membership"."role" = 'owner';--> statement-breakpoint
CREATE TABLE `pending_email_consent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_digest` text NOT NULL,
	`version` text NOT NULL,
	`granted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pending_email_consent_digest_idx` ON `pending_email_consent` (`email_digest`);--> statement-breakpoint
CREATE TABLE `practice` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_entry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`practice_id` integer NOT NULL,
	`global_task_id` integer NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`note` text,
	`target_date` integer,
	`announced_at` integer,
	`acknowledged_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`global_task_id`) REFERENCES `global_task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_entry_practice_task_idx` ON `task_entry` (`practice_id`,`global_task_id`);--> statement-breakpoint
ALTER TABLE `user` ADD `email_consent_granted_at` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `email_consent_version` text;
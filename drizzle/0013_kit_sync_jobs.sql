CREATE TABLE `kit_sync_job` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`run_after` integer DEFAULT (unixepoch()) NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`outcome` text,
	`detail` text,
	`settled_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kit_sync_job_queue_idx` ON `kit_sync_job` (`outcome`,`run_after`);--> statement-breakpoint
CREATE INDEX `kit_sync_job_user_idx` ON `kit_sync_job` (`user_id`,`kind`,`outcome`);--> statement-breakpoint
ALTER TABLE `user` ADD `kit_subscriber_id` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `kit_suppressed_at` integer;
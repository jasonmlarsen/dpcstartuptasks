CREATE TABLE `feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`practice_id` integer NOT NULL,
	`author_user_id` text,
	`text` text NOT NULL,
	`page_path` text NOT NULL,
	`global_task_id` integer,
	`task_title` text,
	`done_at` integer,
	`done_note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`global_task_id`) REFERENCES `global_task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `feedback_done_idx` ON `feedback` (`done_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `feedback_author_idx` ON `feedback` (`author_user_id`,`created_at`);
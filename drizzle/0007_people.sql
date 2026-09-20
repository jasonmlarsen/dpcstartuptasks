CREATE TABLE `invite` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`practice_id` integer NOT NULL,
	`email` text NOT NULL,
	`token_digest` text NOT NULL,
	`invitee_name` text,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practice`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_token_digest_unique` ON `invite` (`token_digest`);--> statement-breakpoint
CREATE INDEX `invite_practice_idx` ON `invite` (`practice_id`);--> statement-breakpoint
CREATE INDEX `invite_email_idx` ON `invite` (`email`);
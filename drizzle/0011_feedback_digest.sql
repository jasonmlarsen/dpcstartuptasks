CREATE TABLE `feedback_digest` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`through_feedback_id` integer NOT NULL,
	`sent_at` integer DEFAULT (unixepoch()) NOT NULL
);

CREATE TABLE `global_task` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`phase_id` integer NOT NULL,
	`body` text NOT NULL,
	`state_specific` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`phase_id`) REFERENCES `phase`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `global_task_slug_unique` ON `global_task` (`slug`);--> statement-breakpoint
CREATE TABLE `helpful_link` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`global_task_id` integer NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`global_task_id`) REFERENCES `global_task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `phase` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `phase_name_unique` ON `phase` (`name`);--> statement-breakpoint
CREATE TABLE `task_dependency` (
	`global_task_id` integer NOT NULL,
	`depends_on_task_id` integer NOT NULL,
	PRIMARY KEY(`global_task_id`, `depends_on_task_id`),
	FOREIGN KEY (`global_task_id`) REFERENCES `global_task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_task_id`) REFERENCES `global_task`(`id`) ON UPDATE no action ON DELETE cascade
);

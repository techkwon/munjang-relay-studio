ALTER TABLE `participants` ADD `warning_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `participants` ADD `last_warning_at` integer;--> statement-breakpoint
ALTER TABLE `participants` ADD `blocked_at` integer;--> statement-breakpoint
ALTER TABLE `rooms` ADD `moderation_nsfw` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `moderation_hate` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `moderation_threat` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `moderation_slang` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `moderation_warning_lock` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `moderation_warning_limit` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `story_turns` ADD `moderation_categories` text;--> statement-breakpoint
ALTER TABLE `story_turns` ADD `moderation_checked_at` integer;

CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`writer_name` text NOT NULL,
	`writer_type` text DEFAULT 'human' NOT NULL,
	`ai_role` text,
	`token_hash` text,
	`slot_index` integer NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`room_code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_participants_room_slot` ON `participants` (`room_code`,`slot_index`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_participants_room_name` ON `participants` (`room_code`,`writer_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_participants_token_hash` ON `participants` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_participants_room_type` ON `participants` (`room_code`,`writer_type`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`room_code` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`writer_limit` integer NOT NULL,
	`human_limit` integer NOT NULL,
	`ai_limit` integer DEFAULT 0 NOT NULL,
	`genre` text NOT NULL,
	`turn_limit` integer NOT NULL,
	`turn_seconds` integer NOT NULL,
	`order_mode` text DEFAULT 'sequential' NOT NULL,
	`current_turn_index` integer DEFAULT 0 NOT NULL,
	`current_deadline_at` integer,
	`seed_index` integer NOT NULL,
	`event_index` integer NOT NULL,
	`story_title` text NOT NULL,
	`story_setup` text NOT NULL,
	`story_opener` text NOT NULL,
	`seed_source` text DEFAULT 'fallback' NOT NULL,
	`reference_note` text,
	`material_kind` text,
	`material_name` text,
	`material_mime` text,
	`material_size` integer,
	`material_key` text,
	`material_note` text,
	`ai_generation_status` text DEFAULT 'idle' NOT NULL,
	`ai_generation_claim` text,
	`ai_generation_state` text,
	`analysis_status` text DEFAULT 'idle' NOT NULL,
	`analysis_report` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`closed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_rooms_owner_status` ON `rooms` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_rooms_updated_at` ON `rooms` (`updated_at`);--> statement-breakpoint
CREATE TABLE `story_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`turn_index` integer NOT NULL,
	`participant_id` text NOT NULL,
	`writer_name` text NOT NULL,
	`writer_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`text` text,
	`deadline_at` integer NOT NULL,
	`submitted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`room_code`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_story_turns_room_turn` ON `story_turns` (`room_code`,`turn_index`);--> statement-breakpoint
CREATE INDEX `idx_story_turns_participant` ON `story_turns` (`participant_id`);--> statement-breakpoint
CREATE INDEX `idx_story_turns_room_status` ON `story_turns` (`room_code`,`status`);

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable(
  "rooms",
  {
    roomCode: text("room_code").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    status: text("status", { enum: ["lobby", "active", "complete", "closed"] }).notNull().default("lobby"),
    writerLimit: integer("writer_limit").notNull(),
    humanLimit: integer("human_limit").notNull(),
    aiLimit: integer("ai_limit").notNull().default(0),
    writerLevels: text("writer_levels").notNull().default("[]"),
    moderationNsfw: integer("moderation_nsfw", { mode: "boolean" }).notNull().default(true),
    moderationHate: integer("moderation_hate", { mode: "boolean" }).notNull().default(true),
    moderationThreat: integer("moderation_threat", { mode: "boolean" }).notNull().default(true),
    moderationSlang: integer("moderation_slang", { mode: "boolean" }).notNull().default(true),
    moderationWarningLock: integer("moderation_warning_lock", { mode: "boolean" }).notNull().default(true),
    moderationWarningLimit: integer("moderation_warning_limit").notNull().default(3),
    genre: text("genre", { enum: ["all", "free", "adventure", "fantasy", "mystery", "daily", "space"] }).notNull(),
    turnLimit: integer("turn_limit").notNull(),
    turnSeconds: integer("turn_seconds").notNull(),
    orderMode: text("order_mode", { enum: ["sequential", "random"] }).notNull().default("sequential"),
    currentTurnIndex: integer("current_turn_index").notNull().default(0),
    currentDeadlineAt: integer("current_deadline_at"),
    seedIndex: integer("seed_index").notNull(),
    eventIndex: integer("event_index").notNull(),
    storyTitle: text("story_title").notNull(),
    storySetup: text("story_setup").notNull(),
    storyOpener: text("story_opener").notNull(),
    seedSource: text("seed_source", { enum: ["ai", "fallback", "manual", "reference"] }).notNull().default("fallback"),
    referenceNote: text("reference_note"),
    materialKind: text("material_kind", { enum: ["image", "pdf"] }),
    materialName: text("material_name"),
    materialMime: text("material_mime"),
    materialSize: integer("material_size"),
    materialKey: text("material_key"),
    materialNote: text("material_note"),
    aiGenerationStatus: text("ai_generation_status", {
      enum: ["idle", "pending", "running", "complete", "failed"],
    })
      .notNull()
      .default("idle"),
    aiGenerationClaim: text("ai_generation_claim"),
    aiGenerationClaimedAt: integer("ai_generation_claimed_at"),
    aiGenerationState: text("ai_generation_state"),
    analysisStatus: text("analysis_status", {
      enum: ["idle", "pending", "running", "complete", "failed"],
    })
      .notNull()
      .default("idle"),
    analysisReport: text("analysis_report"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    closedAt: integer("closed_at"),
  },
  (table) => ({
    ownerStatusIdx: index("idx_rooms_owner_status").on(table.ownerUserId, table.status),
    updatedIdx: index("idx_rooms_updated_at").on(table.updatedAt),
  }),
);

export const participants = sqliteTable(
  "participants",
  {
    id: text("id").primaryKey(),
    roomCode: text("room_code")
      .notNull()
      .references(() => rooms.roomCode, { onDelete: "cascade" }),
    writerName: text("writer_name").notNull(),
    writerType: text("writer_type", { enum: ["human", "ai"] }).notNull().default("human"),
    aiRole: text("ai_role"),
    tokenHash: text("token_hash"),
    slotIndex: integer("slot_index").notNull(),
    warningCount: integer("warning_count").notNull().default(0),
    lastWarningAt: integer("last_warning_at"),
    blockedAt: integer("blocked_at"),
    joinedAt: integer("joined_at").notNull(),
  },
  (table) => ({
    roomSlotIdx: uniqueIndex("uidx_participants_room_slot").on(table.roomCode, table.slotIndex),
    roomNameIdx: uniqueIndex("uidx_participants_room_name").on(table.roomCode, table.writerName),
    tokenIdx: uniqueIndex("uidx_participants_token_hash").on(table.tokenHash),
    roomTypeIdx: index("idx_participants_room_type").on(table.roomCode, table.writerType),
  }),
);

export const storyTurns = sqliteTable(
  "story_turns",
  {
    id: text("id").primaryKey(),
    roomCode: text("room_code")
      .notNull()
      .references(() => rooms.roomCode, { onDelete: "cascade" }),
    turnIndex: integer("turn_index").notNull(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    writerName: text("writer_name").notNull(),
    writerType: text("writer_type", { enum: ["human", "ai"] }).notNull(),
    status: text("status", { enum: ["pending", "submitted", "skipped"] }).notNull().default("pending"),
    text: text("text"),
    moderationCategories: text("moderation_categories"),
    moderationCheckedAt: integer("moderation_checked_at"),
    deadlineAt: integer("deadline_at").notNull(),
    submittedAt: integer("submitted_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    roomTurnIdx: uniqueIndex("uidx_story_turns_room_turn").on(table.roomCode, table.turnIndex),
    participantIdx: index("idx_story_turns_participant").on(table.participantId),
    roomStatusIdx: index("idx_story_turns_room_status").on(table.roomCode, table.status),
  }),
);

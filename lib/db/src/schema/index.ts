import { pgTable, uuid, text, varchar, numeric, integer, boolean, timestamp, jsonb, serial, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const signalOutcomes = pgTable("signal_outcomes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ticker: varchar("ticker", { length: 20 }).notNull(),
  signalType: varchar("signal_type", { length: 50 }),
  signalSource: varchar("signal_source", { length: 50 }).default("replit"),
  strike: numeric("strike", { precision: 10, scale: 2 }),
  expiry: varchar("expiry", { length: 50 }),
  premium: numeric("premium", { precision: 15, scale: 2 }),
  optionType: varchar("option_type", { length: 10 }),
  direction: varchar("direction", { length: 20 }),
  confidence: numeric("confidence", { precision: 5, scale: 2 }),
  convictionScore: integer("conviction_score"),
  category: varchar("category", { length: 50 }),
  reason: text("reason"),
  entryTrigger: text("entry_trigger"),
  target: text("target"),
  invalidation: text("invalidation"),
  outcome: varchar("outcome", { length: 20 }).default("pending"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).default(sql`now()`),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  spreadDetails: jsonb("spread_details"),
  tags: text("tags").array(),
  priceAtSignal: numeric("price_at_signal", { precision: 12, scale: 2 }),
  suggestedTrade: text("suggested_trade"),
  pricePattern: text("price_pattern"),
  maxFavorablePrice: numeric("max_favorable_price", { precision: 12, scale: 2 }),
  mfePercent: numeric("mfe_percent", { precision: 8, scale: 2 }),
  keyLevel: text("key_level"),
  srLevel: text("sr_level"),
  targetNear: text("target_near"),
  maxAdversePrice: numeric("max_adverse_price", { precision: 12, scale: 2 }),
  entryPriceReached: boolean("entry_price_reached").default(false),
  invalidationBreached: boolean("invalidation_breached").default(false),
  pctPastInvalidation: numeric("pct_past_invalidation", { precision: 8, scale: 2 }),
  timeAtTarget: timestamp("time_at_target", { withTimezone: true }),
  entryPrice: numeric("entry_price", { precision: 12, scale: 2 }),
  tradeStatus: varchar("trade_status", { length: 20 }).default("watching"),
  statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }),
  entryHitAt: timestamp("entry_hit_at", { withTimezone: true }),
}, (table) => [
  index("idx_signal_outcomes_ticker").on(table.ticker),
  index("idx_signal_outcomes_category").on(table.category),
  index("idx_signal_outcomes_created").on(table.createdAt),
]);

export const signalAlerts = pgTable("signal_alerts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ticker: varchar("ticker", { length: 20 }).notNull(),
  alertType: varchar("alert_type", { length: 50 }),
  message: text("message"),
  signalId: uuid("signal_id").references(() => signalOutcomes.id),
  read: boolean("read").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`),
});

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }),
  role: varchar("role", { length: 20 }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`),
  userName: varchar("user_name", { length: 255 }),
}, (table) => [
  index("idx_chat_messages_created").on(table.createdAt),
]);

export const chatReactions = pgTable("chat_reactions", {
  id: serial("id").primaryKey(),
  messageId: uuid("message_id").notNull(),
  userId: text("user_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`),
}, (table) => [
  uniqueIndex("chat_reactions_message_id_user_id_emoji_key").on(table.messageId, table.userId, table.emoji),
]);

export const userRoles = pgTable("user_roles", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`),
}, (table) => [
  uniqueIndex("user_roles_user_id_role_key").on(table.userId, table.role),
]);

export const userPriceAlerts = pgTable("user_price_alerts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  ticker: varchar("ticker", { length: 20 }).notNull(),
  targetPrice: numeric("target_price", { precision: 12, scale: 2 }).notNull(),
  condition: varchar("condition", { length: 10 }).notNull(),
  signalId: text("signal_id"),
  label: text("label"),
  active: boolean("active").default(true),
  triggered: boolean("triggered").default(false),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }),
  triggeredPrice: numeric("triggered_price", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`),
}, (table) => [
  index("idx_user_price_alerts_user").on(table.userId),
  index("idx_user_price_alerts_active").on(table.active),
]);

export const userTrades = pgTable("user_trades", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  signalId: text("signal_id").notNull(),
  ticker: text("ticker").notNull(),
  direction: text("direction").notNull(),
  category: text("category"),
  strike: text("strike"),
  expiry: text("expiry"),
  optionType: text("option_type"),
  entryTrigger: text("entry_trigger"),
  target: text("target"),
  invalidation: text("invalidation"),
  convictionScore: integer("conviction_score"),
  takenAt: timestamp("taken_at", { withTimezone: true }).default(sql`now()`),
  signalOutcome: text("signal_outcome").default("pending"),
  outcomePrice: numeric("outcome_price"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  entryPrice: numeric("entry_price"),
});

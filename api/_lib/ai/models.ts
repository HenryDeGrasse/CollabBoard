/**
 * AI Model Configuration
 *
 * All model names are configurable via environment variables so deployments
 * can switch models without code changes. Falls back to sensible defaults.
 *
 * Environment variables:
 *   AI_MODEL_SIMPLE   — Model for simple / fast-path requests (default: gpt-4.1-mini)
 *   AI_MODEL_COMPLEX  — Model for complex multi-step requests  (default: gpt-4.1)
 *   AI_MODEL_CONTENT  — Model for content generation (bulk_create contentPrompt) (default: gpt-4.1-nano)
 *   AI_MODEL_FASTPATH — Model for fast-path template content (SWOT/Kanban/Retro) (default: gpt-4.1-mini)
 */

/** Fast / cheap model for simple requests. */
export const MODEL_SIMPLE = process.env.AI_MODEL_SIMPLE || "gpt-4.1-mini";

/** Smarter model for complex spatial + multi-step reasoning. */
export const MODEL_COMPLEX = process.env.AI_MODEL_COMPLEX || "gpt-4.1";

/** Lightweight model for generating bulk content (e.g. contentPrompt in bulk_create_objects). */
export const MODEL_CONTENT = process.env.AI_MODEL_CONTENT || "gpt-4.1-nano";

/** Model used by fast-path template handlers (SWOT, Kanban, Retro content generation). */
export const MODEL_FASTPATH = process.env.AI_MODEL_FASTPATH || "gpt-4.1-mini";

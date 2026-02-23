// Backward-compatible facade.
//
// Round 2 split:
// - board-types.ts  (shared types + DB/app mappers)
// - board-crud.ts   (board/object/connector CRUD)
// - board-access.ts (membership/invite/access control)
//
// Keep this file so existing imports (`../services/board`) continue to work.

export * from "./board-types";
export * from "./board-crud";
export * from "./board-access";

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Validate that RLS policies don't have infinite recursion.
 *
 * The key rule: a table's own SELECT policy must NOT contain a subquery
 * that SELECTs from the same table, as that triggers recursive policy
 * evaluation in PostgreSQL.
 */
describe("RLS policy recursion safety", () => {
  const migrationPath = join(__dirname, "../../../supabase/migrations/002_fix_rls_recursion.sql");

  let sql: string;
  try {
    sql = readFileSync(migrationPath, "utf-8");
  } catch {
    sql = "";
  }

  it("migration file exists", () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  function extractPolicy(tableName: string, operation: string): string {
    // Extract a multi-line CREATE POLICY statement for a given table and operation
    const regex = new RegExp(
      `CREATE POLICY[\\s\\S]*?ON\\s+${tableName}\\s+FOR\\s+${operation}[\\s\\S]*?;`,
      "gi"
    );
    const matches = sql.match(regex);
    return matches ? matches[0] : "";
  }

  it("board_members SELECT policy does NOT subquery board_members", () => {
    const policy = extractPolicy("board_members", "SELECT");
    expect(policy.length).toBeGreaterThan(0);

    // The policy body should NOT contain "FROM board_members"
    const hasRecursion = /FROM\s+board_members/i.test(policy);
    expect(hasRecursion, `board_members SELECT policy must not query itself:\n${policy}`).toBe(false);
  });

  it("board_members SELECT policy uses direct user_id = auth.uid() check", () => {
    const policy = extractPolicy("board_members", "SELECT");
    expect(policy.length).toBeGreaterThan(0);
    // Should directly check user_id = auth.uid()
    expect(policy).toMatch(/user_id\s*=\s*auth\.uid\(\)/i);
  });

  it("other tables reference board_members with user_id = auth.uid() filter", () => {
    // boards/objects/connectors policies that reference board_members
    // should filter by user_id = auth.uid() so the non-recursive
    // board_members policy is satisfied
    const subqueries = sql.match(/SELECT\s+board_id\s+FROM\s+board_members\s+WHERE\s+user_id\s*=\s*auth\.uid\(\)/gi);
    expect(subqueries).not.toBeNull();
    // Should have multiple occurrences (boards, objects CRUD, connectors CRUD)
    expect(subqueries!.length).toBeGreaterThanOrEqual(8);
  });

  it("drops old recursive policies before creating new ones", () => {
    expect(sql).toMatch(/DROP POLICY.*"Members can see members".*ON\s+board_members/i);
    expect(sql).toMatch(/DROP POLICY.*"Members can read boards".*ON\s+boards/i);
  });
});

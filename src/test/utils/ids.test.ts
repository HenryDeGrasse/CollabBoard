import { describe, it, expect } from "vitest";
import { generateId } from "../../utils/ids";

describe("ids utility", () => {
  it("generates a string", () => {
    expect(typeof generateId()).toBe("string");
  });

  it("generates a valid UUID v4 format", () => {
    const id = generateId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

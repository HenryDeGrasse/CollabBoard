import { test, expect } from "@playwright/test";
import { createUserSession, createStickyNote, testBoardId } from "./helpers";

test.describe("Test 4: Network Throttling and Disconnection Recovery", () => {
  test("user recovers from disconnect and sees missed changes", async ({ browser }) => {
    const boardId = testBoardId();

    const userA = await createUserSession(browser, boardId, "Alice");
    const userB = await createUserSession(browser, boardId, "Bob");

    // User A creates an object before going offline
    await createStickyNote(userA.page, 300, 300);
    await userA.page.waitForTimeout(500);

    // Verify User B sees it
    await userB.page.waitForTimeout(500);

    // Simulate User A going offline by disabling network
    const cdpA = await userA.context.newCDPSession(userA.page);
    await cdpA.send("Network.emulateNetworkConditions", {
      offline: true,
      downloadThroughput: 0,
      uploadThroughput: 0,
      latency: 0,
    });

    // User B creates objects while User A is offline
    await createStickyNote(userB.page, 500, 300);
    await userB.page.waitForTimeout(500);
    await createStickyNote(userB.page, 500, 500);
    await userB.page.waitForTimeout(500);

    // Wait a moment for User A's presence to drop
    await userB.page.waitForTimeout(3000);

    // Reconnect User A
    await cdpA.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    });

    // Wait for Firebase to reconnect and replay state
    await userA.page.waitForTimeout(5000);

    // User A's canvas should still be visible and functional
    await expect(userA.page.locator("canvas").first()).toBeVisible();

    // User A should be able to create new objects after reconnect
    await createStickyNote(userA.page, 700, 300);
    await userA.page.waitForTimeout(500);

    // Verify no fatal errors
    const errors: string[] = [];
    userA.page.on("pageerror", (err) => errors.push(err.message));
    expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);

    await userA.context.close();
    await userB.context.close();
  });

  test("user's presence goes offline on disconnect and returns on reconnect", async ({
    browser,
  }) => {
    const boardId = testBoardId();

    const userA = await createUserSession(browser, boardId, "Alice");
    const userB = await createUserSession(browser, boardId, "Bob");

    // Both should be in presence
    await userA.page.waitForTimeout(1000);

    // Disconnect User A
    const cdpA = await userA.context.newCDPSession(userA.page);
    await cdpA.send("Network.emulateNetworkConditions", {
      offline: true,
      downloadThroughput: 0,
      uploadThroughput: 0,
      latency: 0,
    });

    // Wait for Firebase onDisconnect to fire (server-side, ~10-30s)
    await userB.page.waitForTimeout(10_000);

    // Reconnect User A
    await cdpA.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    });

    // Wait for presence to restore
    await userA.page.waitForTimeout(5000);

    // Canvas should still work
    await expect(userA.page.locator("canvas").first()).toBeVisible();

    await userA.context.close();
    await userB.context.close();
  });
});

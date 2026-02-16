import * as admin from "firebase-admin";

const db = admin.database();

interface ToolResult {
  success: boolean;
  objectId?: string;
  error?: string;
}

// ─── Tool Implementations ─────────────────────────────────────

export async function createStickyNote(
  boardId: string,
  text: string,
  x: number,
  y: number,
  color: string,
  userId: string
): Promise<ToolResult> {
  try {
    const objectsRef = db.ref(`boards/${boardId}/objects`);
    const newRef = objectsRef.push();
    const id = newRef.key!;
    const now = Date.now();

    await newRef.set({
      id,
      type: "sticky",
      x,
      y,
      width: 150,
      height: 150,
      color,
      text,
      rotation: 0,
      zIndex: now,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    return { success: true, objectId: id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function createShape(
  boardId: string,
  type: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  userId: string
): Promise<ToolResult> {
  try {
    const objectsRef = db.ref(`boards/${boardId}/objects`);
    const newRef = objectsRef.push();
    const id = newRef.key!;
    const now = Date.now();

    await newRef.set({
      id,
      type,
      x,
      y,
      width,
      height,
      color,
      rotation: 0,
      zIndex: now,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    return { success: true, objectId: id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function createFrame(
  boardId: string,
  title: string,
  x: number,
  y: number,
  width: number,
  height: number,
  userId: string
): Promise<ToolResult> {
  try {
    const objectsRef = db.ref(`boards/${boardId}/objects`);
    const newRef = objectsRef.push();
    const id = newRef.key!;
    const now = Date.now();

    await newRef.set({
      id,
      type: "frame",
      x,
      y,
      width,
      height,
      color: "#F3F4F6",
      text: title,
      rotation: 0,
      zIndex: now - 1000, // Frames render below other objects
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    return { success: true, objectId: id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function createConnector(
  boardId: string,
  fromId: string,
  toId: string,
  style: string
): Promise<ToolResult> {
  try {
    const connectorsRef = db.ref(`boards/${boardId}/connectors`);
    const newRef = connectorsRef.push();
    const id = newRef.key!;

    await newRef.set({
      id,
      fromId,
      toId,
      style,
    });

    return { success: true, objectId: id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function moveObject(
  boardId: string,
  objectId: string,
  x: number,
  y: number
): Promise<ToolResult> {
  try {
    await db.ref(`boards/${boardId}/objects/${objectId}`).update({
      x,
      y,
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    });
    return { success: true, objectId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function resizeObject(
  boardId: string,
  objectId: string,
  width: number,
  height: number
): Promise<ToolResult> {
  try {
    await db.ref(`boards/${boardId}/objects/${objectId}`).update({
      width,
      height,
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    });
    return { success: true, objectId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function updateText(
  boardId: string,
  objectId: string,
  newText: string
): Promise<ToolResult> {
  try {
    await db.ref(`boards/${boardId}/objects/${objectId}`).update({
      text: newText,
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    });
    return { success: true, objectId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function changeColor(
  boardId: string,
  objectId: string,
  color: string
): Promise<ToolResult> {
  try {
    await db.ref(`boards/${boardId}/objects/${objectId}`).update({
      color,
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    });
    return { success: true, objectId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function getBoardState(boardId: string): Promise<Record<string, any>> {
  const snapshot = await db.ref(`boards/${boardId}/objects`).orderByChild("updatedAt").limitToLast(100).once("value");
  return snapshot.val() || {};
}

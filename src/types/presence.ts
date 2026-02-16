export interface CursorPosition {
  x: number;
  y: number;
}

export interface UserPresence {
  displayName: string;
  cursorColor: string;
  cursor: CursorPosition | null;
  online: boolean;
  lastSeen: number;
  editingObjectId: string | null;
}

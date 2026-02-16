import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock Firebase
vi.mock("../services/firebase", () => ({
  auth: {
    currentUser: { uid: "test-user-1", displayName: "Test User" },
    signOut: vi.fn(),
    onAuthStateChanged: vi.fn(),
  },
  db: {},
}));

// Mock firebase/auth
vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(),
  onAuthStateChanged: vi.fn(),
  signInAnonymously: vi.fn(),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  updateProfile: vi.fn(),
}));

// Mock firebase/database
vi.mock("firebase/database", () => ({
  ref: vi.fn(),
  set: vi.fn(),
  get: vi.fn(),
  push: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  onChildAdded: vi.fn(() => vi.fn()),
  onChildChanged: vi.fn(() => vi.fn()),
  onChildRemoved: vi.fn(() => vi.fn()),
  onValue: vi.fn(() => vi.fn()),
  onDisconnect: vi.fn(() => ({ set: vi.fn(), remove: vi.fn() })),
  serverTimestamp: vi.fn(() => Date.now()),
}));

// Mock Konva (canvas-dependent)
vi.mock("react-konva", () => ({
  Stage: vi.fn(({ children }: any) => children),
  Layer: vi.fn(({ children }: any) => children),
  Rect: vi.fn(() => null),
  Circle: vi.fn(() => null),
  Text: vi.fn(() => null),
  Group: vi.fn(({ children }: any) => children),
  Arrow: vi.fn(() => null),
  Line: vi.fn(() => null),
}));

vi.mock("konva", () => ({
  default: {
    Stage: vi.fn(),
  },
}));

// Stub clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

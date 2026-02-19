import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock Supabase client
vi.mock("../services/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInAnonymously: vi.fn().mockResolvedValue({ error: null }),
      signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
      track: vi.fn(),
      untrack: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
      presenceState: vi.fn(() => ({})),
    })),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ error: null }),
  },
}));

// Mock Konva (canvas-dependent)
vi.mock("react-konva", () => {
  const React = require("react");
  // Layer needs forwardRef so Board.tsx can attach objectsLayerRef and call
  // cache()/clearCache() during zoom.
  const Layer = React.forwardRef(({ children }: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      cache: vi.fn(),
      clearCache: vi.fn(),
    }));
    return children;
  });
  Layer.displayName = "Layer";

  return {
    Stage: vi.fn(({ children }: any) => children),
    Layer,
    Rect: vi.fn(() => null),
    Circle: vi.fn(() => null),
    Text: vi.fn(() => null),
    Group: vi.fn(({ children }: any) => children),
    Arrow: vi.fn(() => null),
    Line: vi.fn(() => null),
  };
});

vi.mock("konva", () => ({
  default: {
    Stage: vi.fn(),
  },
}));

// Stub clipboard API (jsdom only)
if (typeof navigator !== "undefined") {
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
}

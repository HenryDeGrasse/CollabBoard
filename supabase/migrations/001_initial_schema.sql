-- CollabBoard Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Paste → Run

-- ─── Board Metadata ───────────────────────────────────────────
CREATE TABLE boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'Untitled Board',
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ DEFAULT NULL
);

-- ─── Board Members (access control) ──────────────────────────
CREATE TABLE board_members (
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);

-- ─── Board Objects ────────────────────────────────────────────
CREATE TABLE objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sticky', 'rectangle', 'circle', 'line', 'frame', 'text')),
  x DOUBLE PRECISION NOT NULL DEFAULT 0,
  y DOUBLE PRECISION NOT NULL DEFAULT 0,
  width DOUBLE PRECISION NOT NULL DEFAULT 150,
  height DOUBLE PRECISION NOT NULL DEFAULT 150,
  color TEXT NOT NULL DEFAULT '#FBBF24',
  text TEXT DEFAULT '',
  rotation DOUBLE PRECISION NOT NULL DEFAULT 0,
  z_index BIGINT NOT NULL DEFAULT 0,
  parent_frame_id UUID DEFAULT NULL REFERENCES objects(id) ON DELETE SET NULL,
  points DOUBLE PRECISION[] DEFAULT NULL,
  stroke_width DOUBLE PRECISION DEFAULT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Connectors ───────────────────────────────────────────────
CREATE TABLE connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  from_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  to_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  style TEXT NOT NULL DEFAULT 'arrow' CHECK (style IN ('arrow', 'line')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── User Profiles ────────────────────────────────────────────
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'Anonymous',
  avatar_url TEXT DEFAULT NULL,
  auth_method TEXT NOT NULL DEFAULT 'anonymous' CHECK (auth_method IN ('anonymous', 'google')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── AI Command Runs (idempotency + logging) ─────────────────
CREATE TABLE ai_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  command TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed', 'failed')),
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  tool_calls_count INTEGER DEFAULT 0,
  objects_created UUID[] DEFAULT '{}',
  objects_updated UUID[] DEFAULT '{}',
  duration_ms INTEGER DEFAULT 0,
  response JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (board_id, command_id)
);

-- ─── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_objects_board_id ON objects(board_id);
CREATE INDEX idx_objects_board_updated ON objects(board_id, updated_at DESC);
CREATE INDEX idx_connectors_board_id ON connectors(board_id);
CREATE INDEX idx_connectors_from_id ON connectors(from_id);
CREATE INDEX idx_connectors_to_id ON connectors(to_id);
CREATE INDEX idx_board_members_user ON board_members(user_id);
CREATE INDEX idx_ai_runs_board ON ai_runs(board_id, created_at DESC);

-- ─── Row Level Security ───────────────────────────────────────
ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;

-- Boards: anyone authenticated can create
CREATE POLICY "Users can create boards"
  ON boards FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- Boards: members can read
CREATE POLICY "Members can read boards"
  ON boards FOR SELECT TO authenticated
  USING (
    id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

-- Boards: owner can update
CREATE POLICY "Owner can update boards"
  ON boards FOR UPDATE TO authenticated
  USING (owner_id = auth.uid());

-- Board Members: users can add themselves (join)
CREATE POLICY "Users can join boards"
  ON board_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Board Members: members can see other members
CREATE POLICY "Members can see members"
  ON board_members FOR SELECT TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

-- Objects: board members full CRUD
CREATE POLICY "Members can read objects"
  ON objects FOR SELECT TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can create objects"
  ON objects FOR INSERT TO authenticated
  WITH CHECK (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can update objects"
  ON objects FOR UPDATE TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can delete objects"
  ON objects FOR DELETE TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

-- Connectors: same as objects
CREATE POLICY "Members can read connectors"
  ON connectors FOR SELECT TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can create connectors"
  ON connectors FOR INSERT TO authenticated
  WITH CHECK (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can delete connectors"
  ON connectors FOR DELETE TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

-- Profiles: anyone authenticated can read, users manage own
CREATE POLICY "Anyone can read profiles"
  ON profiles FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- AI Runs: members can read
CREATE POLICY "Members can read AI runs"
  ON ai_runs FOR SELECT TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

-- ─── Enable Realtime ──────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE objects;
ALTER PUBLICATION supabase_realtime ADD TABLE connectors;

-- ─── Auto-create profile on signup ────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url, auth_method)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', 'Anonymous'),
    NEW.raw_user_meta_data->>'avatar_url',
    CASE WHEN NEW.is_anonymous THEN 'anonymous' ELSE 'google' END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─── Auto-update updated_at ───────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER objects_updated_at
  BEFORE UPDATE ON objects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER boards_updated_at
  BEFORE UPDATE ON boards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

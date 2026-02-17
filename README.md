# 🎨 CollabBoard — Real-time Collaborative Whiteboard

**🌐 Live Demo: [collab-board-ochre-gamma.vercel.app](https://collab-board-ochre-gamma.vercel.app)**

A real-time collaborative whiteboard that enables multiple users to brainstorm, map ideas, and run workshops simultaneously on an infinite canvas. Built for speed, collaboration, and ease of use.

---

## ✨ Features

### 🎯 Core Tools
- **Sticky Notes** — Square notes with auto-fit text, resize, drag, and color customization
- **Shapes** — Rectangles (free resize) and circles (aspect-locked) with text and colors
- **Lines** — Straight line segments for annotations and diagrams
- **Connectors/Arrows** — Smart arrows that connect objects with edge clipping and follow during drag
- **Frames** — Named containers with clipping, drag-in/drag-out with hysteresis (55% enter / 45% exit), and object count badges

### 🖼️ Canvas & Interaction
- **Infinite Canvas** — Pan with `Space + Drag` or `Right-click + Drag`, zoom with scroll (10%–400%)
- **60 FPS Performance** — Stress-tested with 1000+ objects across 5 concurrent users
- **Multi-select** — Drag-to-select rectangle with intersection detection
- **Drag Preview** — Live visual feedback when dragging objects into/out of frames
- **Smart Layering** — Cross-frame connectors and lines render on top, frames clip contained objects
- **Subtle Borders** — All objects have light borders for better overlap visibility

### ⌨️ Keyboard Shortcuts
- **Tools**: `V` (Select), `S` (Sticky), `R` (Rectangle), `C` (Circle), `A` (Arrow), `L` (Line), `F` (Frame)
- **Actions**: `Delete/Backspace` (delete), `Escape` (deselect/cancel)
- **Edit**: `Ctrl/⌘ + Z` (undo), `Ctrl/⌘ + Shift + Z` or `Ctrl/⌘ + Y` (redo)
- **Clipboard**: `Ctrl/⌘ + C` (copy), `Ctrl/⌘ + V` (paste), `Ctrl/⌘ + D` (duplicate)
- **Help**: `?` (toggle shortcuts panel)
- Platform-aware: Shows `⌘` on Mac, `Ctrl` on Windows/Linux

### 👥 Multiplayer
- **Live Cursors** — See other users' cursors with name labels and color-coded presence
- **Real-time Sync** — All changes propagate to all users within <100ms
- **Edit Locking** — Visual indicators and cursor changes when another user is editing an object
- **Live Draft Preview** — See other users' text as they type (italic, color-coded, 2s throttle)
- **Presence Panel** — Online users list with colored dots, share link button
- **Disconnect Handling** — Graceful cleanup via Firebase `onDisconnect()`

### 🗂️ Dashboard & Board Management
- **My Boards** — Create, view, search, and soft-delete your boards
- **Shared with Me** — See boards others have shared with you
- **Grid/List View** — Toggle between card grid and compact list
- **Search** — Filter boards by title in real-time
- **Join by ID** — Enter a board ID to access shared boards
- **Auto-add on Join** — Boards automatically added to your dashboard when accessed
- **Last Modified Tracking** — See when each board was last updated

### 🎨 Smart Editing
- **Double-click to Edit** — Edit text on any object with HTML textarea overlay
- **Auto-fit Text** — Sticky notes and shapes automatically resize text to fit
- **Luminance-based Text Color** — Text automatically switches to dark/light for readability
- **Undo/Redo** — Per-user local command stack (max 30 depth, own actions only)
- **Copy/Paste/Duplicate** — Full clipboard support including connectors between copied objects

### 🤖 AI Agent
- **Natural Language Commands UI** — Floating prompt box and assistant panel
- **Coming Soon** — Backend integration with OpenAI GPT-4o for object creation, layout, and templating
- **Placeholder Active** — Returns friendly messages while Vercel Serverless Functions integration is finalized

### 🔐 Authentication
- **Anonymous Guest** — Enter a display name to start immediately
- **Google Sign-in** — Persistent identity and board ownership

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript (strict) + Vite |
| Styling | Tailwind CSS |
| Canvas | Konva.js via react-konva |
| Real-time DB | Firebase Realtime Database |
| Auth | Firebase Auth (Anonymous + Google) |
| AI Backend | Vercel Serverless Functions + OpenAI GPT-4o (planned) |
| Hosting | Vercel |
| Testing | Vitest (153 unit/integration tests) + Playwright (7 E2E tests) |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Firebase project with Realtime Database and Authentication enabled
- Firebase CLI: `npm install -g firebase-tools`

### Setup

1. **Clone and install:**
```bash
git clone https://github.com/HenryDeGrasse/CollabBoard.git
cd CollabBoard
npm install
```

2. **Configure Firebase:**
```bash
cp .env.example .env
```
Edit `.env` with your Firebase config:
```
VITE_FIREBASE_API_KEY=your-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

3. **Enable Firebase services:**
   - Go to Firebase Console → Authentication → Sign-in methods
   - Enable **Anonymous** and **Google** providers
   - Go to Realtime Database → Create database (us-central1)
   - Deploy security rules: `firebase deploy --only database`

4. **Run locally:**
```bash
npm run dev
```
Open http://localhost:5173

5. **Run with Firebase Emulator (for testing):**
```bash
npm run emulators        # In one terminal
npm run dev:emulator     # In another terminal
```

---

## 📁 Project Structure

```
src/
├── components/
│   ├── canvas/          # Board, StickyNote, Shape, Connector, Frame, LineTool, RemoteCursor, ResizeHandles
│   ├── toolbar/         # Toolbar, ColorPicker
│   ├── sidebar/         # PresencePanel, AICommandInput
│   ├── ui/              # Button, HelpPanel
│   └── auth/            # AuthProvider, LoginPage
├── hooks/               # useBoard, usePresence, useCanvas, useSelection, useAIAgent, useUndoRedo
├── services/            # firebase, board, presence, ai-agent
├── types/               # board, presence, ai
├── utils/               # colors, geometry, throttle, ids, text-fit, selection, frame-containment
├── test/                # 153 Vitest unit + integration tests
└── pages/               # HomePage (dashboard), BoardPage (whiteboard)
e2e/                     # 7 Playwright E2E tests + stress test (1000 objects, 5 users)
docs/                    # PRDs, TODO, planning artifacts
firebase.json            # Firebase config + emulator settings
database.rules.json      # Security rules
```

---

## 🏗️ Architecture

```
Client (React + Konva) ←→ Firebase Realtime DB ←→ Security Rules
                                 ↓
                          /boards/{boardId}/
                          ├── /objects/{objectId}
                          ├── /connectors/{connectorId}
                          ├── /cursors/{userId}
                          ├── /presence/{userId}
                          └── /metadata
                                 ↓
                          /userBoards/{userId}/{boardId}
```

### Performance & Sync Strategy
- **Direct SDK writes** for <100ms latency on object changes
- **Throttled cursor sync** at 40ms intervals (~25 updates/sec)
- **Throttled drag sync** at 80ms with final write on drag end
- **Throttled draft text** at 2s intervals (reduces write amplification)
- **Last-write-wins** conflict resolution (Firebase default)
- **Local undo/redo** (no remote propagation)

### Frame Containment Model
- **Explicit membership** via `parentFrameId` field on objects
- **Drag-in threshold**: 55% overlap to enter a frame
- **Drag-out threshold**: 45% overlap to exit (hysteresis prevents jitter)
- **Live preview**: Objects show clipped in-frame preview during drag
- **Cursor-based override**: Objects can overlap frames when cursor is inside
- **Boundary collision**: Objects push against frame edges unless cursor is inside

---

## ✅ Testing

### Unit & Integration Tests (153 tests)
```bash
npm test                  # Run all tests once
npm run test:watch        # Watch mode
```

**Test coverage:**
- 18 test files
- Components: `computeResize`, `frame-interaction`, `help-panel`
- Hooks: `useCanvas`, `useSelection`, `useUndoRedo`
- Services: `board`
- Utils: `colors`, `frame-containment`, `geometry`, `ids`, `selection`, `text-fit`, `throttle`
- Integration: `ai-command-input`, `home-page`, `login-page`, `toolbar`
- Types: `board`

### E2E Tests (7 tests + 1 stress test)
```bash
npm run test:e2e          # Run against emulators
npm run test:e2e:prod     # Run against production
npm run test:stress       # 1000 objects, 5 browsers
```

**E2E scenarios:**
- Two users editing simultaneously
- Refresh persistence
- Rapid object creation (20 objects/sec)
- Network disconnect recovery
- Five concurrent users
- Stress test: 1000 objects, 5 users, 60 FPS average

---

## 🚦 Quality Gates

**Husky hooks enforce:**
- **Pre-commit**: `npm test` (153 tests must pass)
- **Pre-push**: `npm test` + `npm run build` (both must pass)

**Never push broken code** — hooks block commits/pushes on failure.

---

## 📦 Deployment

### Vercel (Frontend)
Automatic deployment on push to `main` branch (if GitHub connected):
```bash
git push origin main
```

Manual deployment:
```bash
npx vercel --prod
```

**Environment Variables** (set in Vercel dashboard):
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

### Firebase (Database + Auth)
```bash
firebase deploy --only database    # Deploy security rules
```

---

## 📊 Performance

**Stress Test Results:**
- **1000 objects** across 5 concurrent browser sessions
- **60.4 FPS** average (well above 60 FPS target)
- **Real-time sync** maintained across all sessions
- **No degradation** with complex multi-user interactions

---

## 🔑 Key Design Decisions

- **Space+drag for pan, regular drag for selection** — Avoids conflict between pan and multi-select (Figma/Miro pattern)
- **Frame explicit membership over spatial auto-absorb** — Objects have `parentFrameId` field; membership determined by center point during drag end
- **Resize via stage-level mouse tracking** — Eliminates flicker
- **Luminance-based text color** — `(0.299*R + 0.587*G + 0.114*B)/255 > 0.5` threshold
- **Selection uses intersection not containment** — Any overlap selects
- **Connector selection via line-segment-rect intersection** — Geometric algorithm for accurate arrow selection
- **Undo only reverts own actions** — Standard collaborative app approach (max 30 depth)
- **Test files excluded from production build** — `tsconfig.app.json` excludes `src/test`
- **TDD mandatory** — `.pi/AGENTS.md` enforces Red→Green→Refactor for all changes
- **Firebase Emulator default for tests** — `USE_EMULATORS=true` by default
- **Cross-frame connectors and lines always visible** — Render on top of frames to avoid clipping

---

## 🗺️ Roadmap

See `docs/TODO.md` for the full backlog. Key upcoming features:

- **AI Agent Integration** — Vercel Serverless Functions + OpenAI for natural language commands
- **Access Control** — Public/private boards, share by link or email
- **Teams & Organizations** — Multi-user workspaces
- **Export/Import** — JSON export, image export (PNG/SVG)
- **Templates** — Pre-built layouts for common use cases
- **Comments & Annotations** — Threaded discussions on objects

---

## 📄 License

MIT License — see LICENSE file for details.

---

## 🤝 Contributing

This is a personal project built for learning and demonstration. Contributions are welcome:

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit with descriptive messages
4. Ensure all tests pass (`npm test`)
5. Push and open a PR

---

## 🙏 Acknowledgments

Built with:
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Konva.js](https://konvajs.org/) for canvas rendering
- [Firebase](https://firebase.google.com/) for real-time sync
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [Vite](https://vitejs.dev/) for blazing fast builds
- [Vitest](https://vitest.dev/) + [Playwright](https://playwright.dev/) for testing

---

**Questions or feedback?** Open an issue or reach out!

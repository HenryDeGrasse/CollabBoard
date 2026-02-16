# 🎨 CollabBoard — Real-time Collaborative Whiteboard

A real-time collaborative whiteboard that enables multiple users to brainstorm, map ideas, and run workshops simultaneously on an infinite canvas. An AI agent extends the board with natural language commands.

## ✨ Features

### Core Collaboration
- **Infinite Canvas** — Pan and zoom (10%–400%) with smooth 60 FPS performance
- **Sticky Notes** — Create, drag, and edit text in real-time
- **Shapes** — Rectangles, circles, and lines with color customization
- **Frames** — Named containers for organizing content
- **Connectors** — Lines and arrows between objects
- **Real-time Sync** — All changes sync to all users within <100ms

### Multiplayer
- **Live Cursors** — See other users' cursors with name labels in real-time
- **Presence Awareness** — See who's online with colored indicators
- **Edit Locking** — Prevents simultaneous text editing conflicts
- **Disconnect Handling** — Graceful cleanup via Firebase `onDisconnect()`

### AI Agent
- **Natural Language Commands** — "Create a SWOT analysis", "Arrange in a grid"
- **11 Command Types** — Creation, manipulation, layout, and complex templates
- **9 Tool Functions** — createStickyNote, createShape, createFrame, moveObject, etc.
- **Real-time Results** — AI changes appear instantly via existing Firebase listeners

### Authentication
- **Anonymous Guest** — Enter a display name to start immediately
- **Google Sign-in** — Persistent identity with Google account

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript (strict) + Vite |
| Styling | Tailwind CSS |
| Canvas | Konva.js via react-konva |
| Real-time DB | Firebase Realtime Database |
| Auth | Firebase Auth (Anonymous + Google) |
| AI Backend | Firebase Cloud Functions + OpenAI GPT-4o |
| Hosting | Vercel |

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Firebase project with Realtime Database and Authentication enabled
- OpenAI API key (for AI agent)

### Setup

1. **Clone and install:**
```bash
git clone <repo-url>
cd CollabBoard
npm install
cd functions && npm install && cd ..
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
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

3. **Enable Firebase services:**
   - Go to Firebase Console → Authentication → Sign-in methods
   - Enable **Anonymous** and **Google** providers
   - Go to Realtime Database → Create database
   - Deploy security rules: `firebase deploy --only database`

4. **Deploy Cloud Functions:**
```bash
firebase functions:secrets:set OPENAI_API_KEY
cd functions && npm run build && cd ..
firebase deploy --only functions
```

5. **Run locally:**
```bash
npm run dev
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `V` | Select tool |
| `S` | Sticky note tool |
| `R` | Rectangle tool |
| `C` | Circle tool |
| `F` | Frame tool |
| `Delete/Backspace` | Delete selected objects |
| `Double-click` | Edit text on sticky notes/frames |
| `Scroll` | Zoom in/out |
| `Drag (on canvas)` | Pan the canvas |

## 📁 Project Structure

```
src/
├── components/
│   ├── canvas/       # Board, StickyNote, Shape, Frame, Connector, RemoteCursor
│   ├── toolbar/      # Toolbar, ColorPicker
│   ├── sidebar/      # PresencePanel, AICommandInput
│   ├── auth/         # AuthProvider, LoginPage
│   └── ui/           # Button, shared UI components
├── hooks/            # useBoard, usePresence, useCanvas, useSelection, useAIAgent
├── services/         # Firebase init, board/presence/AI service layers
├── types/            # TypeScript interfaces (BoardObject, Presence, AI)
├── utils/            # Colors, geometry, throttle, IDs
└── pages/            # HomePage, BoardPage
functions/
└── src/              # Cloud Function: AI agent with OpenAI + tool execution
```

## 🏗️ Architecture

```
Client (React + Konva) ←→ Firebase Realtime DB (objects, presence, cursors)
                        → Firebase Cloud Functions → OpenAI GPT-4o (AI commands)
```

- **No traditional backend** — Firebase handles all real-time sync
- **Direct SDK writes** for <100ms latency on object changes
- **Throttled cursor sync** at 40ms intervals (~25 updates/sec)
- **Throttled drag sync** at 80ms intervals with final write on drag end
- **Last-write-wins** conflict resolution (Firebase default)

## 📦 Deployment

### Vercel (Frontend)
```bash
npm run build
# Deploy dist/ to Vercel via GitHub auto-deploy or CLI
```

### Firebase (Backend)
```bash
firebase deploy
```

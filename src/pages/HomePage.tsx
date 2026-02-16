import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "../components/auth/AuthProvider";

interface HomePageProps {
  onNavigateToBoard: (boardId: string) => void;
}

export function HomePage({ onNavigateToBoard }: HomePageProps) {
  const { displayName, signOut } = useAuth();
  const [joinBoardId, setJoinBoardId] = useState("");

  const handleCreateBoard = () => {
    const boardId = uuidv4().slice(0, 8);
    onNavigateToBoard(boardId);
  };

  const handleJoinBoard = () => {
    if (joinBoardId.trim()) {
      onNavigateToBoard(joinBoardId.trim());
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-cyan-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md mx-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">🎨 CollabBoard</h1>
          <p className="text-gray-500">
            Welcome, <span className="font-medium text-gray-700">{displayName}</span>!
          </p>
        </div>

        <div className="space-y-6">
          {/* Create new board */}
          <button
            onClick={handleCreateBoard}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-medium hover:bg-indigo-700 transition text-lg shadow-md hover:shadow-lg"
          >
            + Create New Board
          </button>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white text-gray-400">or join existing</span>
            </div>
          </div>

          {/* Join board */}
          <div className="flex gap-2">
            <input
              id="join-board-id"
              name="boardId"
              type="text"
              value={joinBoardId}
              onChange={(e) => setJoinBoardId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoinBoard()}
              placeholder="Enter Board ID"
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
            />
            <button
              onClick={handleJoinBoard}
              disabled={!joinBoardId.trim()}
              className="px-6 py-2.5 bg-gray-800 text-white rounded-lg font-medium hover:bg-gray-900 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Join
            </button>
          </div>

          {/* Sign out */}
          <button
            onClick={signOut}
            className="w-full text-gray-400 text-sm hover:text-gray-600 transition mt-4"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

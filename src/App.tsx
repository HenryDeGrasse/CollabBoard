import { useState, useEffect } from "react";
import { AuthProvider, useAuth } from "./components/auth/AuthProvider";
import { LoginPage } from "./components/auth/LoginPage";
import { HomePage } from "./pages/HomePage";
import { BoardPage } from "./pages/BoardPage";

type Route =
  | { page: "home" }
  | { page: "board"; boardId: string };

function parseRoute(): Route {
  const path = window.location.pathname;
  const boardMatch = path.match(/^\/board\/([a-zA-Z0-9-]+)$/);
  if (boardMatch) {
    return { page: "board", boardId: boardMatch[1] };
  }
  return { page: "home" };
}

function AppContent() {
  const { user, loading } = useAuth();
  const [route, setRoute] = useState<Route>(parseRoute);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      setRoute(parseRoute());
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigateTo = (newRoute: Route) => {
    const path = newRoute.page === "board" ? `/board/${newRoute.boardId}` : "/";
    window.history.pushState(null, "", path);
    setRoute(newRoute);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        onSuccess={() => {
          // After login, check if we should go to a board directly
          const currentRoute = parseRoute();
          setRoute(currentRoute);
        }}
      />
    );
  }

  switch (route.page) {
    case "board":
      return (
        <BoardPage
          boardId={route.boardId}
          onNavigateHome={() => navigateTo({ page: "home" })}
        />
      );
    case "home":
    default:
      return (
        <HomePage
          onNavigateToBoard={(boardId) =>
            navigateTo({ page: "board", boardId })
          }
        />
      );
  }
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;

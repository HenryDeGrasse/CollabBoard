import { useState, useEffect, lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "./components/auth/AuthProvider";
import { LoginPage } from "./components/auth/LoginPage";
import { HomePage } from "./pages/HomePage";

// Lazy-load BoardPage so Konva/react-konva are not downloaded on the home page
const BoardPage = lazy(() =>
  import("./pages/BoardPage").then((m) => ({ default: m.BoardPage }))
);

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

  // After Google OAuth the browser lands on the app origin ("/").
  // If the user was on a /board/<id> link before being redirected to login,
  // LoginPage saves that path. We restore it here once the user is logged in.
  useEffect(() => {
    if (!user) return;
    const returnTo = localStorage.getItem("collabboard_oauth_return_to");
    if (!returnTo) return;
    localStorage.removeItem("collabboard_oauth_return_to");
    const boardMatch = returnTo.match(/^\/board\/([a-zA-Z0-9-]+)$/);
    if (boardMatch) {
      const boardId = boardMatch[1];
      window.history.pushState(null, "", `/board/${boardId}`);
      setRoute({ page: "board", boardId });
    }
  }, [user]);

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
    return <LoginPage />;
  }

  switch (route.page) {
    case "board":
      return (
        <Suspense
          fallback={
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
              <div className="animate-spin w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full" />
            </div>
          }
        >
          <BoardPage
            boardId={route.boardId}
            onNavigateHome={() => navigateTo({ page: "home" })}
          />
        </Suspense>
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

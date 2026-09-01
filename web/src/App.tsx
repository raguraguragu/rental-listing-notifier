import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Users from "./pages/Users";
import Manual from "./pages/Manual";

// どのURLでどの画面を出すかの一覧（ルーティング）。
// ログイン必須の画面は RequireAuth で包む。
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Home />
            </RequireAuth>
          }
        />
        <Route
          path="/users"
          element={
            <RequireAuth>
              <Users />
            </RequireAuth>
          }
        />
        <Route
          path="/manual"
          element={
            <RequireAuth>
              <Manual />
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

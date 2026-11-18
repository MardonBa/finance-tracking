import "./ui/tokens.css";
import "./App.css";
import { useEffect, useState } from "react";
import { API_URL } from "./api/client";

type Health = { status: "checking" } | { status: "up"; env: string } | { status: "down" };

/** Placeholder until the shell track lands: shows whether the local backend is reachable. */
function App() {
  const [health, setHealth] = useState<Health>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/health`)
      .then((r) => r.json() as Promise<{ env: string }>)
      .then((body) => !cancelled && setHealth({ status: "up", env: body.env }))
      .catch(() => !cancelled && setHealth({ status: "down" }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <section className="card">
        <h1>Finance Tracker</h1>
        <p className="muted">
          {health.status === "checking" && "Checking the backend…"}
          {health.status === "up" && `Backend is up (${health.env}) at ${API_URL}`}
          {health.status === "down" && `Backend not reachable at ${API_URL}. Run npm run dev from the repo root.`}
        </p>
      </section>
    </div>
  );
}

export default App;

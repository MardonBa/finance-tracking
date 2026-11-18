import "./ui/tokens.css";
import "./App.css";
import { lazy, Suspense, useEffect, useState } from "react";
import { AuthGate } from "./auth/AuthGate.tsx";

/** Dev-only styleguide at #styleguide; tree-shaken out of production builds. */
const Styleguide = import.meta.env.DEV ? lazy(() => import("./ui/Styleguide.tsx")) : null;

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function App() {
  const hash = useHash();
  if (Styleguide && hash === "#styleguide") {
    return (
      <Suspense fallback={null}>
        <Styleguide />
      </Suspense>
    );
  }
  return <AuthGate />;
}

export default App;

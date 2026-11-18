import "./App.css";

const sections = ["Overview", "Accounts", "Transactions", "Investments", "Insights"] as const;

function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <h1 className="brand">Finance Tracker</h1>
        <nav>
          {sections.map((s) => (
            <button key={s} className="nav-item" type="button">
              {s}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">
        <h2>Overview</h2>
        <p className="muted">No accounts connected yet. Bank sync (Plaid) comes next. See decisions.md.</p>
      </main>
    </div>
  );
}

export default App;

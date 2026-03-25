export default function App() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#e5e5e5",
      fontFamily: "monospace",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: 12,
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#fff" }}>Biddie AI</div>
      <div style={{ fontSize: 13, color: "#22c55e" }}>● API Server Online</div>
      <div style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
        Institutional options flow analysis — powered by Unusual Whales
      </div>
    </div>
  );
}

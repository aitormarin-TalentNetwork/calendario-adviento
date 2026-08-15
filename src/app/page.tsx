export default function Home() {
  return (
    <main
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "2rem" }}>🎄 Calendario de Adviento</h1>
      <p style={{ color: "var(--accent)" }}>Hola mundo — esqueleto desplegado en Railway.</p>
    </main>
  );
}

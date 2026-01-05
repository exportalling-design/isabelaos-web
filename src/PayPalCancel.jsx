export default function PayPalCancel() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#05060A", color: "white" }}>
      <div style={{ maxWidth: 520, padding: 20, border: "1px solid rgba(255,255,255,.12)", borderRadius: 18 }}>
        <h2>Pago cancelado</h2>
        <p style={{ opacity: 0.8 }}>Cancelaste el proceso en PayPal. No se realizó ningún cobro.</p>
        <button
          onClick={() => (window.location.href = "/")}
          style={{ marginTop: 14, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,.2)", background: "transparent", color: "white" }}
        >
          Volver
        </button>
      </div>
    </div>
  );
}
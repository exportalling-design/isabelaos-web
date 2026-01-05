// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { AuthProvider } from "./context/AuthContext.jsx";

// ✅ NUEVO: pantallas de retorno/cancelación de PayPal
import PayPalReturn from "./PayPalReturn.jsx";
import PayPalCancel from "./PayPalCancel.jsx";

// ✅ Router mínimo (sin react-router)
function RootRouter() {
  const path = window.location.pathname;

  // OJO: debe coincidir EXACTO con create-subscription.js
  if (path === "/billing/return") return <PayPalReturn />;
  if (path === "/billing/cancel") return <PayPalCancel />;

  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <RootRouter />
    </AuthProvider>
  </React.StrictMode>
);
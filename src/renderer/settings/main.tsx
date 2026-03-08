import React from "react";
import { createRoot } from "react-dom/client";
import { SettingsApp } from "./SettingsApp";
import "../styles/globals.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing root element");
}

createRoot(container).render(
  <React.StrictMode>
    <SettingsApp />
  </React.StrictMode>
);

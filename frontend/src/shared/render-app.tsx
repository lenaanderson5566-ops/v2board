import { createRoot } from "react-dom/client";
import type { ComponentType } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { languageReady } from "./i18n";

export async function renderApp(App: ComponentType) {
    await languageReady;
    createRoot(document.getElementById("root")!).render(
        <ErrorBoundary>
            <App />
        </ErrorBoundary>,
    );
}

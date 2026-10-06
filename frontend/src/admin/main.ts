import { initializeRuntime, startupError } from "../shared/runtime-config";

void initializeRuntime("admin").then(async () => {
    const [{ default: App }, { renderApp }] = await Promise.all([import("./AdminApp"), import("../shared/render-app")]);
    await renderApp(App);
}).catch(startupError);

import { initializeRuntime, startupError } from "../shared/runtime-config";

void initializeRuntime("user").then(async () => {
    const [{ default: App }, { renderApp }] = await Promise.all([import("./app"), import("../shared/render-app")]);
    await renderApp(App);
}).catch(startupError);

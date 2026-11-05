import { registerHooks } from "node:module";

const shim = new URL("./forge-api-shim.mjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@forge/api") {
      return { url: shim, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

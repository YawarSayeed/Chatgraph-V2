/**
 * Module hooks that let plain `node` run the app's TypeScript modules directly.
 *
 * Node 24 strips types on its own but resolves specifiers strictly, so this adds
 * the two things the app's sources assume from the bundler: the `@/` root alias
 * and extensionless imports. JSON is resolved with the import attribute Node
 * requires but TypeScript source does not write.
 *
 * Used by the gate conformance harness. Not part of the browser build.
 */

import module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".json"];

function resolveFile(base) {
  if (path.extname(base) && fs.existsSync(base)) return base;
  for (const extension of EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const extension of EXTENSIONS) {
    const candidate = path.join(base, `index${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith("@/")) {
      base = path.join(ROOT, specifier.slice(2));
    } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }
    const resolved = base ? resolveFile(base) : null;
    if (!resolved) return nextResolve(specifier, context);

    const isJson = resolved.endsWith(".json");
    return {
      url: pathToFileURL(resolved).href,
      shortCircuit: true,
      ...(isJson ? { format: "json", importAttributes: { type: "json" } } : {})
    };
  }
});

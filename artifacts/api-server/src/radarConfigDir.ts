// Must be evaluated before any radar-core module is imported.
//
// radar-core resolves its scoring/signal/connector catalogs at import time,
// relative to the running file. esbuild bundles this host into dist/index.mjs,
// so without an explicit location the bundled runtime would look for a
// config/ directory next to dist/ instead of the one shipped with the core,
// and the live API could score differently from the node --test suite.
// Point the core at its own config/ directory (a sibling of both src/ and
// dist/) unless an operator has set RADAR_CONFIG_DIR explicitly.
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env["RADAR_CONFIG_DIR"]) {
  process.env["RADAR_CONFIG_DIR"] = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../radar-core/config",
  );
}

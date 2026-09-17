import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const wrangler = JSON.parse(read("wrangler.json"));

test("Cloudflare deployment registers compiled WebAssembly used by the OG renderer", () => {
  const wasmRule = wrangler.rules.find((rule) => rule.type === "CompiledWasm");
  assert.ok(wasmRule);
  assert.deepEqual(wasmRule.globs, ["**/*.wasm"]);
});

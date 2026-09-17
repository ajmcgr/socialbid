import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const renderer = read("src/lib/creator-og.server.ts");
const packageJson = JSON.parse(read("package.json"));

test("creator OG rendering is portable across the deployed worker runtime", () => {
  assert.equal(packageJson.dependencies["@cf-wasm/resvg"], undefined);
  assert.match(renderer, /new CompressionStream\("deflate"\)/);
  assert.match(renderer, /pngChunk\("IDAT", compressed\)/);
  assert.match(renderer, /fetchAvatar\(view\.creator\.profile_image_url\)/);
});

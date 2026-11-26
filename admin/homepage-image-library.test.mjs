import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { HOMEPAGE_IMAGE_LIBRARY } from "./homepage-image-library.mjs";

test("homepage image library includes every tracked asset in the three client-friendly groups", () => {
  const groups = HOMEPAGE_IMAGE_LIBRARY.reduce((counts, image) => {
    counts[image.group] = (counts[image.group] || 0) + 1;
    return counts;
  }, {});

  assert.equal(HOMEPAGE_IMAGE_LIBRARY.length, 45);
  assert.deepEqual(groups, { website: 6, products: 17, lookbook: 22 });
  assert.equal(new Set(HOMEPAGE_IMAGE_LIBRARY.map((image) => image.path)).size, 45);
  for (const image of HOMEPAGE_IMAGE_LIBRARY) {
    assert.ok(image.description, `${image.path} needs a visual description`);
    assert.ok(existsSync(new URL(`../${image.path}`, import.meta.url)), `${image.path} must exist`);
  }
});

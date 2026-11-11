import assert from "node:assert/strict";
import test from "node:test";
import { selectVisibleCatalogue } from "./public-catalogue.mjs";

const categories = [
  { id: "bridal", name: "Bridal", slug: "bridal", active: true },
  { id: "inactive", name: "Inactive", slug: "inactive", active: false },
];

const products = [
  { id: "visible", status: "published", category_id: "bridal", homepage_visible: true, lookbook_visible: true },
  { id: "inactive-category", status: "published", category_id: "inactive", homepage_visible: true, lookbook_visible: true },
  { id: "uncategorised", status: "published", category_id: null, homepage_visible: true, lookbook_visible: true },
  { id: "draft", status: "draft", category_id: "bridal", homepage_visible: true, lookbook_visible: true },
];

const images = [
  { id: "later", product_id: "visible", bucket_id: "catalogue-public", approved_at: "2026-01-02", sort_order: 2 },
  { id: "first", product_id: "visible", bucket_id: "catalogue-public", approved_at: "2026-01-01", sort_order: 1 },
  { id: "staging", product_id: "visible", bucket_id: "catalogue-staging", approved_at: null, sort_order: 0 },
  { id: "unapproved", product_id: "inactive-category", bucket_id: "catalogue-public", approved_at: null, sort_order: 0 },
  { id: "uncategorised-image", product_id: "uncategorised", bucket_id: "catalogue-public", approved_at: "2026-01-01", sort_order: 0 },
  { id: "draft-image", product_id: "draft", bucket_id: "catalogue-public", approved_at: "2026-01-01", sort_order: 0 },
];

test("homepage selection includes only published homepage designs with approved public images", () => {
  const result = selectVisibleCatalogue(products, categories, images, "homepage");
  assert.deepEqual(result.visible.map(({ id }) => id), ["visible", "uncategorised"]);
  assert.equal(result.imageMap.get("visible").id, "first");
  assert.deepEqual([...result.categoryMap.keys()], ["bridal"]);
});

test("lookbook selection excludes uncategorised, inactive-category, and unpublished designs", () => {
  const result = selectVisibleCatalogue(products, categories, images, "lookbook");
  assert.deepEqual(result.visible.map(({ id }) => id), ["visible"]);
  assert.equal(result.imageMap.has("inactive-category"), false);
});

test("selection rejects unsupported public destinations", () => {
  assert.throws(() => selectVisibleCatalogue([], [], [], "admin"), /supported public catalogue destination/);
});

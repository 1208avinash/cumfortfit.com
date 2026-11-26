import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductPayload,
  filterCatalogueProducts,
  formatCatalogueError,
  loadCatalogueData,
  saveCatalogueProduct,
  setCatalogueProductArchived,
} from "./catalogue.mjs";

const products = [
  { id: "1", title: "Ivory Kurta", legacy_code: "CF-01", slug: "ivory-kurta", description: "", status: "published", category_id: "cat-1" },
  { id: "2", title: "Blue Blouse", legacy_code: "CF-02", slug: "blue-blouse", description: "", status: "draft", category_id: "cat-2" },
  { id: "3", title: "Archived Saree", legacy_code: "CF-03", slug: "archived-saree", description: "", status: "archived", category_id: null },
];

test("catalogue filters combine case-insensitive search, status, and category", () => {
  assert.deepEqual(filterCatalogueProducts(products, "IVORY", "all", "all").map((item) => item.id), ["1"]);
  assert.deepEqual(filterCatalogueProducts(products, "CF-", "draft", "cat-2").map((item) => item.id), ["2"]);
  assert.deepEqual(filterCatalogueProducts(products, "", "archived", "all").map((item) => item.id), ["3"]);
});

test("editors can create drafts and update only editable product fields", () => {
  const values = {
    title: " New title ",
    description: "",
    legacy_code: "CF-04",
    slug: "new-title",
    record_type: "design_reference",
    audience: "women",
    category_id: "",
    status: "published",
  };
  assert.deepEqual(buildProductPayload(values, "editor"), {
    title: "New title",
    description: null,
    audience: "women",
    category_id: null,
    legacy_code: "CF-04",
    slug: "new-title",
    record_type: "design_reference",
    status: "draft",
  });
  assert.deepEqual(buildProductPayload(values, "editor", { id: "1", status: "published" }), {
    title: "New title",
    description: null,
    audience: "women",
    category_id: null,
  });
});

test("manager insert defaults visibility flags off and editor cannot bypass role checks", () => {
  const values = {
    title: "New design",
    description: "",
    legacy_code: "CF-05",
    slug: "new-design",
    record_type: "orderable_product",
    audience: "not_set",
    category_id: "",
    status: "published",
  };
  const payload = buildProductPayload(values, "admin");
  assert.equal(payload.status, "published");
  assert.equal(payload.homepage_visible, false);
  assert.equal(payload.lookbook_visible, false);
  assert.equal(payload.pricing_public, false);
  assert.throws(() => buildProductPayload(values, "visitor"), /active studio role/i);
});

test("catalogue loader reads only existing product and category columns", async () => {
  const calls = [];
  const images = [{
    id: "image-1",
    product_id: "1",
    bucket_id: "catalogue-public",
    storage_path: "catalogue/ivory.webp",
    alt_text: "Ivory design",
    sort_order: 0,
    approved_at: "2026-01-01",
  }];
  const client = {
    from(table) {
      const query = {
        select(columns) { calls.push({ table, columns }); return query; },
        order(column, options) { calls.push({ table, column, options }); return query; },
        in(column, values) { calls.push({ table, column, values }); return query; },
        range(start, end) { calls.push({ table, start, end }); query.start = start; query.end = end; return query; },
        then(resolve) {
          const data = table === "products" ? products : table === "product_images" ? images : [];
          return Promise.resolve({ data: query.start === undefined ? data : data.slice(query.start, query.end + 1), error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const result = await loadCatalogueData(client);
  assert.equal(result.products.length, 3);
  assert.deepEqual(result.products.map((product) => product.status), ["published", "draft", "archived"]);
  assert.deepEqual(result.images, images);
  assert.ok(calls.some(({ table, columns }) => table === "products" && columns.includes("legacy_code")));
  assert.ok(calls.some(({ table, columns }) => table === "categories" && columns === "id,name,slug,sort_order,active"));
  assert.ok(calls.some(({ table, column, values }) => table === "product_images" && column === "product_id" && values.length === 3));
  assert.ok(!calls.some(({ table, column }) => table === "products" && ["status", "archived"].includes(column)));
});

test("catalogue loader paginates beyond the API page limit", async () => {
  const allProducts = Array.from({ length: 1001 }, (_, index) => ({
    id: `product-${index}`,
    status: index === 0 ? "published" : index === 1 ? "draft" : "archived",
  }));
  const productRanges = [];
  const client = {
    from(table) {
      let start = 0;
      let end = 0;
      const query = {
        select() { return query; },
        order() { return query; },
        in() { return query; },
        range(first, last) { start = first; end = last; if (table === "products") productRanges.push([first, last]); return query; },
        then(resolve) {
          const rows = table === "products" ? allProducts : [];
          return Promise.resolve({ data: rows.slice(start, end + 1), error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const result = await loadCatalogueData(client);
  assert.equal(result.products.length, 1001);
  assert.deepEqual(productRanges, [[0, 499], [500, 999], [1000, 1499]]);
});

test("save, archive, and restore use updates without permanent deletion", async () => {
  const calls = [];
  const client = {
    from(table) {
      const query = {
        update(payload) { calls.push({ table, operation: "update", payload }); return query; },
        insert(payload) { calls.push({ table, operation: "insert", payload }); return query; },
        eq(column, value) { calls.push({ column, value }); return query; },
        select() { return query; },
        single() { return Promise.resolve({ data: { id: "1" }, error: null }); },
      };
      return query;
    },
  };
  await saveCatalogueProduct(client, {
    title: "Updated",
    description: "",
    legacy_code: "CF-01",
    slug: "updated",
    record_type: "design_reference",
    audience: "women",
    category_id: "",
    status: "draft",
  }, "admin", { id: "1", status: "published" });
  await setCatalogueProductArchived(client, { id: "1" }, "admin", true);
  await setCatalogueProductArchived(client, { id: "1" }, "owner", false);
  await assert.rejects(
    setCatalogueProductArchived(client, { id: "1" }, "editor", true),
    /Only Owner and Admin roles/i,
  );
  const updates = calls.filter(({ operation }) => operation);
  assert.deepEqual(updates.map(({ operation }) => operation), ["update", "update", "update"]);
  assert.ok(calls.every(({ operation }) => operation !== "delete"));
  assert.deepEqual(updates[1].payload, {
    status: "archived",
    homepage_visible: false,
    lookbook_visible: false,
    pricing_public: false,
  });
  assert.equal(updates[2].payload.status, "draft");
});

test("permission and constraint errors are actionable", () => {
  assert.match(formatCatalogueError({ code: "42501" }, "save"), /role does not have permission/i);
  assert.match(formatCatalogueError({ code: "23505" }, "save"), /already in use/i);
  assert.match(formatCatalogueError({ code: "23514", message: "Specific database constraint" }, "save"), /Specific database constraint/);
});

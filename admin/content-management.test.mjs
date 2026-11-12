import test from "node:test";
import assert from "node:assert/strict";
import {
  approveProductImage,
  buildCategoryPayload,
  filterCategories,
  hideProductImage,
  publicImageUrl,
  saveCategory,
  setProductPublicVisibility,
  setCategoryActive,
  slugFromCategoryName,
  updateProductImage,
  uploadStagingImage,
  validateImageFile,
} from "./content-management.mjs";

test("category slugs are generated safely from a category name", () => {
  assert.equal(slugFromCategoryName("  Bridal & Occasion Wear  "), "bridal-occasion-wear");
});

test("category filters include inactive categories only when requested", () => {
  const categories = [
    { name: "Bridal", slug: "bridal", active: true },
    { name: "Archive", slug: "archive", active: false },
  ];
  assert.deepEqual(filterCategories(categories, "brid", "active"), [categories[0]]);
  assert.deepEqual(filterCategories(categories, "", "inactive"), [categories[1]]);
  assert.deepEqual(filterCategories(categories, "", "all"), categories);
});

test("category payload validates values and allows existing staff roles", () => {
  assert.deepEqual(buildCategoryPayload({
    name: "Bridal",
    slug: "bridal",
    sort_order: "2",
    active: false,
  }, "editor"), {
    name: "Bridal",
    slug: "bridal",
    sort_order: 2,
    active: false,
  });
  assert.throws(() => buildCategoryPayload({
    name: "Bridal",
    slug: "Bad Slug",
    sort_order: "0",
    active: true,
  }, "admin"), /lowercase slug/);
  assert.throws(() => buildCategoryPayload({
    name: "Bridal",
    slug: "bridal",
    sort_order: "-1",
    active: true,
  }, "admin"), /whole number/);
});

test("category create, rename, reorder, deactivate, and restore use existing rows", async () => {
  const calls = [];
  const client = {
    from(table) {
      const query = {
        insert(payload) { calls.push({ operation: "insert", table, payload }); return query; },
        update(payload) { calls.push({ operation: "update", table, payload }); return query; },
        eq(column, value) { calls.push({ operation: "eq", table, column, value }); return query; },
        select() { return query; },
        async single() { return { data: { id: "category-1" }, error: null }; },
      };
      return query;
    },
  };
  await saveCategory(client, {
    name: "Bridal",
    slug: "bridal",
    sort_order: "1",
    active: true,
  }, "editor");
  await saveCategory(client, {
    name: "Bridal Couture",
    slug: "bridal-couture",
    sort_order: "2",
    active: true,
  }, "admin", { id: "category-1" });
  await setCategoryActive(client, { id: "category-1" }, "owner", false);
  await setCategoryActive(client, { id: "category-1" }, "admin", true);

  assert.deepEqual(calls.filter(({ operation }) => operation !== "eq").map(({ operation }) => operation),
    ["insert", "update", "update", "update"]);
  assert.deepEqual(calls[0].payload, {
    name: "Bridal",
    slug: "bridal",
    sort_order: 1,
    active: true,
    parent_id: null,
  });
  assert.deepEqual(calls[1].payload, {
    name: "Bridal Couture",
    slug: "bridal-couture",
    sort_order: 2,
    active: true,
  });
  const updates = calls.filter(({ operation }) => operation === "update");
  assert.deepEqual(updates.slice(1).map(({ payload }) => payload), [{ active: false }, { active: true }]);
});

test("image validation accepts only supported image formats up to 10 MB", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/avif"]) {
    assert.ok(validateImageFile({ type, size: 10 * 1024 * 1024 }));
  }
  assert.throws(() => validateImageFile({ type: "image/svg+xml", size: 100 }), /JPEG, PNG, WebP or AVIF/);
  assert.throws(() => validateImageFile({ type: "image/png", size: 10 * 1024 * 1024 + 1 }), /10 MB/);
});

test("Editors upload images to staging with product assignment and can reorder image metadata", async () => {
  const calls = [];
  const client = {
    storage: {
      from(bucket) {
        return {
          async upload(path, file, options) {
            calls.push({ operation: "storage-upload", bucket, path, file, options });
            return { error: null };
          },
        };
      },
    },
    from(table) {
      const query = {
        insert(payload) { calls.push({ operation: "insert", table, payload }); return query; },
        update(payload) { calls.push({ operation: "update", table, payload }); return query; },
        eq(column, value) { calls.push({ operation: "eq", table, column, value }); return query; },
        select() { return query; },
        async single() { return { data: { id: "image-1" }, error: null }; },
      };
      return query;
    },
  };
  const uploaded = await uploadStagingImage(client, {
    product_id: "product-1",
    file: new Blob(["image"], { type: "image/png" }),
    alt_text: "Embroidered blouse",
    caption: "Hand embroidery",
    sort_order: "3",
  }, "editor");
  await updateProductImage(client, { id: "image-1" }, {
    alt_text: "Updated alternative text",
    caption: "Updated caption",
    sort_order: "1",
  }, "editor");

  assert.equal(uploaded.id, "image-1");
  assert.equal(calls[0].bucket, "catalogue-staging");
  assert.match(calls[0].path, /^products\/product-1\/.+\.png$/);
  assert.deepEqual(calls[1].payload, {
    product_id: "product-1",
    bucket_id: "catalogue-staging",
    storage_path: calls[0].path,
    alt_text: "Embroidered blouse",
    caption: "Hand embroidery",
    sort_order: 3,
    is_primary: false,
    approved_at: null,
    approved_by: null,
  });
  assert.deepEqual(calls[2].payload, {
    alt_text: "Updated alternative text",
    caption: "Updated caption",
    sort_order: 1,
  });
});

test("public image URLs encode path segments", () => {
  assert.equal(
    publicImageUrl("https://example.supabase.co/", "products/item one/image.webp"),
    "https://example.supabase.co/storage/v1/object/public/catalogue-public/products/item%20one/image.webp",
  );
});

test("Editors cannot change product public destinations", async () => {
  await assert.rejects(
    setProductPublicVisibility({}, { id: "p1", status: "published" }, "lookbook_visible", true, "editor"),
    /Only Owner and Admin/,
  );
});

test("Editors cannot approve or hide images", async () => {
  await assert.rejects(approveProductImage({}, {
    bucket_id: "catalogue-staging",
    approved_at: null,
  }, "editor", "user-1"), /Only Owner and Admin/);
  await assert.rejects(hideProductImage({}, {
    bucket_id: "catalogue-public",
    approved_at: "2026-01-01",
  }, "editor"), /Only Owner and Admin/);
});

function mockApprovalClient({
  image,
  approvalResponse,
  rollbackResponse,
  uploadError = null,
  publicCleanupError = null,
  stagingCleanupError = null,
} = {}) {
  const calls = [];
  const updates = [];
  const client = {
    storage: {
      from(bucket) {
        return {
          async download(path) {
            calls.push({ operation: "download", bucket, path });
            return { data: new Blob(["image"], { type: "image/webp" }), error: null };
          },
          async upload(path, file, options) {
            calls.push({ operation: "upload", bucket, path, options });
            return { error: bucket === "catalogue-public" ? uploadError : null };
          },
          async remove(paths) {
            calls.push({ operation: "remove", bucket, path: paths[0] });
            const error = bucket === "catalogue-public" ? publicCleanupError : stagingCleanupError;
            return { error };
          },
        };
      },
    },
    from(table) {
      const query = {
        update(payload) {
          const update = { operation: "update", table, payload, filters: [] };
          updates.push(update);
          calls.push(update);
          return query;
        },
        eq(column, value) {
          updates.at(-1).filters.push(["eq", column, value]);
          return query;
        },
        is(column, value) {
          updates.at(-1).filters.push(["is", column, value]);
          return query;
        },
        select() { return query; },
        async maybeSingle() {
          const update = updates.at(-1);
          if (update === updates[0]) {
            return approvalResponse || {
              data: { ...image, ...update.payload },
              error: null,
            };
          }
          return rollbackResponse || {
            data: { ...image, ...update.payload },
            error: null,
          };
        },
      };
      return query;
    },
  };
  return { client, calls, updates };
}

const stagingImage = {
  id: "image-1",
  product_id: "product-1",
  bucket_id: "catalogue-staging",
  storage_path: "products/product-1/image.webp",
  approved_at: null,
  approved_by: null,
};

test("Owner approval transitions the expected row before upload and then removes the staging copy", async () => {
  const { client, calls, updates } = mockApprovalClient({ image: stagingImage });
  const result = await approveProductImage(client, stagingImage, "owner", "owner-1");

  assert.equal(result.image.bucket_id, "catalogue-public");
  assert.deepEqual(calls.map(({ operation }) => operation), [
    "download", "update", "upload", "remove",
  ]);
  assert.deepEqual(updates[0].filters, [
    ["eq", "id", stagingImage.id],
    ["eq", "bucket_id", "catalogue-staging"],
    ["is", "approved_at", null],
  ]);
  assert.deepEqual(calls[2], {
    operation: "upload",
    bucket: "catalogue-public",
    path: stagingImage.storage_path,
    options: { contentType: "image/webp", upsert: false },
  });
  assert.deepEqual(calls[3], {
    operation: "remove",
    bucket: "catalogue-staging",
    path: stagingImage.storage_path,
  });
});

test("database approval failure prevents the public upload", async () => {
  const databaseError = new Error("Database update failed");
  const { client, calls } = mockApprovalClient({
    image: stagingImage,
    approvalResponse: { data: null, error: databaseError },
  });

  await assert.rejects(
    approveProductImage(client, stagingImage, "owner", "owner-1"),
    (error) => error === databaseError,
  );
  assert.deepEqual(calls.map(({ operation }) => operation), ["download", "update"]);
});

test("failed public upload is cleaned up, reverted to staging, and reports the original error", async () => {
  const uploadError = new Error("Public upload failed");
  const { client, calls, updates } = mockApprovalClient({
    image: stagingImage,
    uploadError,
  });

  await assert.rejects(
    approveProductImage(client, stagingImage, "owner", "owner-1"),
    (error) => error === uploadError,
  );
  assert.deepEqual(calls.map(({ operation }) => operation), [
    "download", "update", "upload", "remove", "update",
  ]);
  assert.deepEqual(updates[1].payload, {
    bucket_id: "catalogue-staging",
    approved_at: null,
    approved_by: null,
  });
  assert.deepEqual(updates[1].filters, [
    ["eq", "id", stagingImage.id],
    ["eq", "bucket_id", "catalogue-public"],
    ["eq", "approved_at", updates[0].payload.approved_at],
    ["eq", "approved_by", "owner-1"],
  ]);
});

test("failed rollback reports the upload error and requires database verification", async () => {
  const { client, calls } = mockApprovalClient({
    image: stagingImage,
    uploadError: new Error("Public upload failed"),
    rollbackResponse: { data: null, error: new Error("Database rollback failed") },
  });

  await assert.rejects(
    approveProductImage(client, stagingImage, "owner", "owner-1"),
    (error) => {
      assert.match(error.message, /Public upload failed/);
      assert.match(error.message, /Database rollback failed/);
      assert.match(error.message, /public object was removed/);
      assert.match(error.message, /Verify the database record/);
      return true;
    },
  );
  assert.deepEqual(calls.map(({ operation }) => operation), [
    "download", "update", "upload", "remove", "update",
  ]);
});

test("failed public upload and failed cleanup preserve approval and report a recovery warning", async () => {
  const { client, calls, updates } = mockApprovalClient({
    image: stagingImage,
    uploadError: new Error("Public upload failed"),
    publicCleanupError: new Error("Public cleanup failed"),
  });

  const result = await approveProductImage(client, stagingImage, "admin", "admin-1");
  assert.equal(result.image.bucket_id, "catalogue-public");
  assert.equal(result.image.approved_by, "admin-1");
  assert.match(result.warning, /Public image upload failed/);
  assert.match(result.warning, /public object could not be removed/);
  assert.match(result.warning, /record remains approved/);
  assert.equal(updates.length, 1);
  assert.deepEqual(calls.map(({ operation }) => operation), [
    "download", "update", "upload", "remove",
  ]);
});

test("successful public approval preserves warning behavior when staging cleanup fails", async () => {
  const { client, calls } = mockApprovalClient({
    image: stagingImage,
    stagingCleanupError: new Error("Staging cleanup failed"),
  });

  const result = await approveProductImage(client, stagingImage, "owner", "owner-1");
  assert.equal(result.image.bucket_id, "catalogue-public");
  assert.match(result.warning, /approved, but its staging copy could not be removed/);
  assert.deepEqual(calls.map(({ operation }) => operation), [
    "download", "update", "upload", "remove",
  ]);
});

test("Admin hiding retains the image in staging and removes its public copy", async () => {
  const calls = [];
  const image = {
    id: "image-2",
    product_id: "product-1",
    bucket_id: "catalogue-public",
    storage_path: "products/product-1/image.webp",
    approved_at: "2026-11-11",
  };
  const client = {
    storage: {
      from(bucket) {
        return {
          async download(path) {
            calls.push(["download", bucket, path]);
            return { data: new Blob(["image"], { type: "image/webp" }), error: null };
          },
          async upload(path) {
            calls.push(["upload", bucket, path]);
            return { error: null };
          },
          async remove(paths) {
            calls.push(["remove", bucket, paths[0]]);
            return { error: null };
          },
        };
      },
    },
    from(table) {
      const query = {
        update(payload) {
          calls.push(["update", table, payload]);
          return query;
        },
        eq() { return query; },
        select() { return query; },
        async single() { return { data: { ...image, bucket_id: "catalogue-staging", approved_at: null }, error: null }; },
      };
      return query;
    },
  };
  const result = await hideProductImage(client, image, "admin");
  assert.equal(result.bucket_id, "catalogue-staging");
  assert.deepEqual(calls.map((call) => call[0]), ["download", "upload", "remove", "update"]);
  assert.deepEqual(calls[2], ["remove", "catalogue-public", image.storage_path]);
});

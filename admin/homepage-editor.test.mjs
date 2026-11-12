import assert from "node:assert/strict";
import test from "node:test";
import {
  HOMEPAGE_SECTIONS,
  collectHomepagePublishErrors,
  emptySectionContent,
  formatHomepageError,
  isHomepageManager,
  loadHomepageEditorData,
  publishHomepageDraft,
  saveHomepageDraft,
  validateHomepageDraftStructure,
} from "./homepage-editor.mjs";

function mockClient({ tableResults = {}, rpcResults = {} } = {}) {
  const calls = [];
  const queues = new Map(Object.entries(tableResults).map(([table, results]) => [table, [...results]]));
  return {
    calls,
    client: {
      from(table) {
        const result = queues.get(table)?.shift() ?? { data: [], error: null };
        const query = {
          select(columns) { calls.push({ kind: "select", table, columns }); return query; },
          eq(column, value) { calls.push({ kind: "eq", table, column, value }); return query; },
          order(column, options) { calls.push({ kind: "order", table, column, options }); return query; },
          maybeSingle() { return Promise.resolve(result); },
          then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
        };
        return query;
      },
      async rpc(name, args) {
        calls.push({ kind: "rpc", name, args });
        const result = rpcResults[name];
        return typeof result === "function" ? result(args) : (result ?? { data: null, error: null });
      },
    },
  };
}

test("only Owner and Admin roles pass the Homepage Editor UX gate", () => {
  assert.equal(isHomepageManager("owner"), true);
  assert.equal(isHomepageManager("admin"), true);
  assert.equal(isHomepageManager("editor"), false);
  assert.equal(isHomepageManager("visitor"), false);
  assert.equal(isHomepageManager(null), false);
});

test("section definitions match the eight migration keys and initialize required structured fields", () => {
  assert.deepEqual(HOMEPAGE_SECTIONS.map(({ key }) => key), [
    "hero", "introduction", "craft-film", "collection",
    "process", "atelier", "cta", "faq",
  ]);
  assert.equal(emptySectionContent("craft-film").scenes.length, 4);
  assert.equal(emptySectionContent("process").steps.length, 4);
  assert.equal(emptySectionContent("faq").items.length, 4);
  assert.throws(() => emptySectionContent("banner"), /Unknown homepage section/);
});

test("draft loading creates one draft only when none exists and reads related rows", async () => {
  const draft = { id: "draft-id", status: "draft", lock_version: 1 };
  const { client, calls } = mockClient({
    tableResults: {
      homepage_releases: [
        { data: null, error: null },
        { data: draft, error: null },
      ],
      homepage_section_revisions: [{ data: [{ section_key: "hero" }], error: null }],
      homepage_release_products: [{ data: [{ product_id: "product-id", sort_order: 0 }], error: null }],
      products: [{ data: [{ id: "product-id", status: "published", homepage_visible: true }], error: null }],
    },
    rpcResults: {
      create_homepage_draft: { data: "draft-id", error: null },
    },
  });

  const result = await loadHomepageEditorData(client);
  assert.equal(result.release.id, "draft-id");
  assert.equal(result.sections[0].section_key, "hero");
  assert.equal(result.selectedProducts[0].product_id, "product-id");
  assert.equal(result.products[0].id, "product-id");
  assert.equal(calls.filter((call) => call.kind === "rpc" && call.name === "create_homepage_draft").length, 1);
});

test("draft loading reuses an existing release without creating another", async () => {
  const { client, calls } = mockClient({
    tableResults: {
      homepage_releases: [{ data: { id: "existing", status: "draft", lock_version: 7 }, error: null }],
      homepage_section_revisions: [{ data: [], error: null }],
      homepage_release_products: [{ data: [], error: null }],
      products: [{ data: [], error: null }],
    },
  });

  const result = await loadHomepageEditorData(client);
  assert.equal(result.release.lock_version, 7);
  assert.equal(calls.some((call) => call.kind === "rpc"), false);
});

test("saving uses the migration RPC name, parameter names, and current lock version", async () => {
  const { client, calls } = mockClient({
    rpcResults: { save_homepage_draft: { data: 4, error: null } },
  });
  const release = { id: "draft-id", lock_version: 3 };
  const sections = HOMEPAGE_SECTIONS.map((definition, sort_order) => ({
    section_key: definition.key,
    section_type: definition.key,
    content: emptySectionContent(definition.key),
    is_visible: true,
    sort_order,
  }));
  const productIds = [];

  assert.deepEqual(validateHomepageDraftStructure(sections), []);
  assert.equal(await saveHomepageDraft(client, release, sections, productIds), 4);
  assert.deepEqual(calls[0], {
    kind: "rpc",
    name: "save_homepage_draft",
    args: {
      p_release_id: "draft-id",
      p_expected_version: 3,
      p_sections: sections,
      p_product_ids: productIds,
    },
  });
});

test("saving a draft preserves a selected staging image path", async () => {
  const { client, calls } = mockClient({
    rpcResults: { save_homepage_draft: { data: 5, error: null } },
  });
  const sections = HOMEPAGE_SECTIONS.map((definition, sort_order) => ({
    section_key: definition.key,
    section_type: definition.key,
    content: emptySectionContent(definition.key),
    is_visible: true,
    sort_order,
  }));
  sections.find((section) => section.section_key === "hero").content.image_path =
    "products/product-1/selected-image.webp";

  await saveHomepageDraft(client, { id: "draft-id", lock_version: 4 }, sections, []);

  assert.equal(
    calls[0].args.p_sections.find((section) => section.section_key === "hero").content.image_path,
    "products/product-1/selected-image.webp",
  );
});

test("incomplete text, images, and product selection are allowed in a structurally valid draft", () => {
  const sections = HOMEPAGE_SECTIONS.map((definition, sort_order) => ({
    section_key: definition.key,
    section_type: definition.key,
    content: emptySectionContent(definition.key),
    is_visible: true,
    sort_order,
  }));

  assert.deepEqual(validateHomepageDraftStructure(sections), []);
  const errors = collectHomepagePublishErrors(sections, [], []);
  assert.ok(errors.some((error) => error.includes("Eyebrow is required")));
  assert.ok(errors.some((error) => error.includes("safe, supported image path")));
  assert.ok(errors.some((error) => error.includes("exactly eight homepage products")));
});

test("draft structure still rejects unsupported or malformed data", () => {
  const sections = HOMEPAGE_SECTIONS.map((definition, sort_order) => ({
    section_key: definition.key,
    section_type: definition.key,
    content: emptySectionContent(definition.key),
    is_visible: true,
    sort_order,
  }));
  sections[0].section_key = "unsupported";
  assert.ok(validateHomepageDraftStructure(sections).some((error) => error.includes("unsupported section key")));
});

test("publishing uses the migration RPC and expected lock version", async () => {
  const { client, calls } = mockClient({
    rpcResults: { publish_homepage_release: { data: 5, error: null } },
  });
  assert.equal(await publishHomepageDraft(client, { id: "draft-id", lock_version: 4 }), 5);
  assert.deepEqual(calls[0], {
    kind: "rpc",
    name: "publish_homepage_release",
    args: { p_release_id: "draft-id", p_expected_version: 4 },
  });
});

test("optimistic-lock errors are presented as explicit reload conflicts", () => {
  assert.match(formatHomepageError({ code: "40001" }, "save"), /changed since you opened it/i);
  assert.match(formatHomepageError({ code: "42501" }, "publish"), /Owner and Admin/i);
  assert.match(formatHomepageError({ code: "PGRST202" }, "load"), /migration or RPCs are not installed/i);
});

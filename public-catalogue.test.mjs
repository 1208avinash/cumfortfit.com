import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStudioPreviewSelection,
  preparePublishedHomepage,
  prepareStudioHomepagePreview,
  renderPublishedHomepage,
  selectVisibleCatalogue,
} from "./public-catalogue.mjs";

const publishedRelease = { id: "release-1", status: "published" };

function renderHeroHeading(headingText) {
  const heading = {
    children: [],
    replaceChildren(...children) { this.children = children; },
  };
  const hero = {
    dataset: { homepageSection: "hero" },
    querySelector(selector) { return selector === "h1" ? heading : null; },
  };
  const main = {
    querySelectorAll() { return [hero]; },
    append() {},
  };
  const originalDocument = globalThis.document;
  globalThis.document = {
    querySelector() { return main; },
    createTextNode(text) { return { nodeType: 3, textContent: text }; },
    createElement(tagName) {
      return {
        nodeType: 1,
        tagName,
        children: [],
        append(child) { this.children.push(child); },
      };
    },
  };

  try {
    const homepage = preparePublishedHomepage(publishedRelease, [{
      section_key: "hero",
      section_type: "hero",
      content: { heading: headingText },
      is_visible: true,
      sort_order: 0,
    }], [], []);
    renderPublishedHomepage(homepage, { url: "https://project.supabase.co" });
    return heading.children;
  } finally {
    globalThis.document = originalDocument;
  }
}

test("studio preview selection captures the correct section images and posters", () => {
  const heroImage = {
    alt: "Hero alt",
    currentSrc: "https://example.supabase.co/storage/v1/object/public/catalogue-public/homepage/hero.webp",
    src: "fallback-hero.webp",
    matches(selector) { return selector === ".hero-image img"; },
  };
  const atelierImage = {
    alt: "Atelier alt",
    currentSrc: "https://example.supabase.co/storage/v1/object/public/catalogue-public/homepage/atelier.webp",
    src: "fallback-atelier.webp",
    matches(selector) { return selector === ".atelier-photo img"; },
  };
  const posterVideo = {
    id: "stitch-film",
    paused: true,
    poster: "https://example.supabase.co/storage/v1/object/public/catalogue-public/homepage/poster.webp",
  };

  assert.deepEqual(buildStudioPreviewSelection("hero", {
    closest(selector) {
      if (selector === "img") return heroImage;
      if (selector === "video") return null;
      return null;
    },
  }), {
    imageAlt: "Hero alt",
    imageCurrentSrc: heroImage.currentSrc,
    imageField: "image_path",
    preventDefault: true,
  });

  assert.deepEqual(buildStudioPreviewSelection("atelier", {
    closest(selector) {
      if (selector === "img") return atelierImage;
      if (selector === "video") return null;
      return null;
    },
  }), {
    imageAlt: "Atelier alt",
    imageCurrentSrc: atelierImage.currentSrc,
    imageField: "image_path",
    preventDefault: true,
  });

  assert.deepEqual(buildStudioPreviewSelection("craft-film", {
    closest(selector) {
      if (selector === "img") return null;
      if (selector === "video") return posterVideo;
      return null;
    },
  }), {
    imageAlt: "",
    imageCurrentSrc: posterVideo.poster,
    imageField: "poster_path",
    preventDefault: false,
  });
});

test("published homepage content renders into the existing section using text and validated URLs", () => {
  const image = {};
  const arrow = {};
  const heading = { children: [], replaceChildren(...children) { this.children = children; } };
  const button = {
    children: [arrow],
    querySelector(selector) { return selector === ".arrow" ? arrow : null; },
    replaceChildren(...children) { this.children = children; },
    append(child) { this.children.push(child); },
  };
  const hero = {
    dataset: { homepageSection: "hero" },
    children: [],
    selectors: new Map([
      [".eyebrow", {}],
      ["h1", heading],
      [".hero-copy", {}],
      [".hero-image img", image],
      [".hero-actions a.button.light", button],
    ]),
    querySelector(selector) { return this.selectors.get(selector) || null; },
  };
  const main = {
    children: [hero],
    querySelectorAll() { return [hero]; },
    append(...children) { this.children = children; },
  };
  const originalDocument = globalThis.document;
  globalThis.document = {
    querySelector() { return main; },
    createTextNode(text) { return { textContent: text }; },
  };

  try {
    const result = preparePublishedHomepage(publishedRelease, [
      {
        section_key: "hero",
        section_type: "hero",
        content: {
          eyebrow: "Studio",
          heading: "<img src=x onerror=alert(1)>",
          body: "A considered fit.",
          image_path: "homepage/hero.webp",
          image_alt: "Couture model",
          primary_cta_label: "Explore",
          primary_cta_href: "#collections",
        },
        is_visible: true,
        sort_order: 0,
      },
    ], [], []);

    const config = { url: "https://project.supabase.co" };
    const signedStagingUrl = "https://project.supabase.co/storage/v1/object/sign/catalogue-staging/products/p1/image.webp?token=preview";
    renderPublishedHomepage(result, config, { "homepage/hero.webp": signedStagingUrl });

    assert.deepEqual(heading.children, [{ textContent: "<img src=x onerror=alert(1)>" }]);
    assert.equal(image.src, signedStagingUrl);
    assert.equal(image.alt, "Couture model");
    assert.equal(button.children[0].textContent, "Explore ");
    assert.equal(button.children[1], arrow);
    assert.equal(hero.hidden, false);

    renderPublishedHomepage(result, config, {
      "homepage/hero.webp": "https://attacker.example/image.webp",
    });
    assert.equal(image.src, "https://project.supabase.co/storage/v1/object/public/catalogue-public/homepage/hero.webp");
  } finally {
    globalThis.document = originalDocument;
  }
});

test("homepage heading newlines render as explicit line breaks", () => {
  const children = renderHeroHeading("The art of\na perfect fit.");

  assert.deepEqual(children.map((node) =>
    node.tagName ? node.tagName : node.textContent), ["The art of", "br", "a perfect fit."]);
});

test("homepage heading *emphasis* renders with an explicit emphasis element", () => {
  const children = renderHeroHeading("The art of *a perfect fit*.");

  assert.equal(children[0].textContent, "The art of ");
  assert.equal(children[1].tagName, "em");
  assert.deepEqual(children[1].children, [{ nodeType: 3, textContent: "a perfect fit" }]);
  assert.equal(children[2].textContent, ".");
});

test("homepage heading HTML and script attempts remain plain text nodes", () => {
  const payload = "<script>alert(1)</script><img src=x onerror=alert(1)>";
  const children = renderHeroHeading(payload);

  assert.deepEqual(children, [{ nodeType: 3, textContent: payload }]);
});

test("published homepage sections are prepared in saved display order", () => {
  const sections = [
    { section_key: "collection", section_type: "collection", content: { heading: "Curated designs" }, is_visible: true, sort_order: 2 },
    { section_key: "hero", section_type: "hero", content: { heading: "A personal fit" }, is_visible: true, sort_order: 0 },
  ];

  const result = preparePublishedHomepage(publishedRelease, sections, [], []);

  assert.deepEqual(result.sections.map(({ section_key }) => section_key), ["hero", "collection"]);
  assert.equal(result.sections[0].content.heading, "A personal fit");
});

test("published homepage omits hidden sections", () => {
  const sections = [
    { section_key: "hero", section_type: "hero", content: {}, is_visible: true, sort_order: 0 },
    { section_key: "process", section_type: "process", content: {}, is_visible: false, sort_order: 1 },
  ];

  const result = preparePublishedHomepage(publishedRelease, sections, [], []);

  assert.deepEqual(result.sections.map(({ section_key }) => section_key), ["hero"]);
  assert.ok(result.hiddenSectionKeys.includes("process"));
});

test("published homepage products follow the curated release order", () => {
  const products = [
    { id: "first", status: "published", homepage_visible: true },
    { id: "second", status: "published", homepage_visible: true },
    { id: "draft", status: "draft", homepage_visible: true },
  ];
  const releaseProducts = [
    { product_id: "second", sort_order: 0 },
    { product_id: "first", sort_order: 1 },
    { product_id: "draft", sort_order: 2 },
  ];

  const result = preparePublishedHomepage(publishedRelease, [], releaseProducts, products);

  assert.deepEqual(result.products.map(({ id }) => id), ["second", "first"]);
});

test("absence of a published homepage release leaves the existing homepage as fallback", () => {
  assert.equal(preparePublishedHomepage(null, [], [], []), null);
});

test("studio preview applies hidden sections, saved order, and curated product order", () => {
  const keys = ["hero", "introduction", "craft-film", "collection", "process", "atelier", "cta", "faq"];
  const sections = keys.map((section_key, sort_order) => ({
    section_key,
    section_type: section_key,
    content: {},
    is_visible: section_key !== "faq",
    sort_order: keys.length - sort_order,
  }));
  const products = [
    { id: "design-a", status: "published", homepage_visible: true },
    { id: "design-b", status: "published", homepage_visible: true },
  ];

  const result = prepareStudioHomepagePreview(sections, ["design-b", "design-a"], products);

  assert.deepEqual(result.sections.map(({ section_key }) => section_key), [
    "cta", "atelier", "process", "collection", "craft-film", "introduction", "hero",
  ]);
  assert.ok(result.hiddenSectionKeys.includes("faq"));
  assert.deepEqual(result.products.map(({ id }) => id), ["design-b", "design-a"]);
  assert.equal(prepareStudioHomepagePreview(sections.slice(1), [], products), null);
});

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
  { id: "later", product_id: "visible", bucket_id: "catalogue-public", storage_path: "products/visible/later.webp", approved_at: "2026-01-02", sort_order: 2 },
  { id: "first", product_id: "visible", bucket_id: "catalogue-public", storage_path: "products/visible/first.webp", approved_at: "2026-01-01", sort_order: 1 },
  { id: "staging", product_id: "visible", bucket_id: "catalogue-staging", storage_path: "products/visible/staging.webp", approved_at: null, sort_order: 0 },
  { id: "unapproved", product_id: "inactive-category", bucket_id: "catalogue-public", storage_path: "products/inactive/unapproved.webp", approved_at: null, sort_order: 0 },
  { id: "uncategorised-image", product_id: "uncategorised", bucket_id: "catalogue-public", storage_path: "products/uncategorised/image.webp", approved_at: "2026-01-01", sort_order: 0 },
  { id: "draft-image", product_id: "draft", bucket_id: "catalogue-public", storage_path: "products/draft/image.webp", approved_at: "2026-01-01", sort_order: 0 },
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

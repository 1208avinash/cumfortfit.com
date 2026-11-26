export const HOMEPAGE_SECTIONS = [
  {
    key: "hero",
    label: "Hero",
    fields: ["eyebrow", "heading", "body", "image_path", "image_alt", "primary_cta_label", "primary_cta_href"],
  },
  {
    key: "introduction",
    label: "Introduction",
    fields: ["eyebrow", "heading", "body", "supporting_body"],
  },
  {
    key: "craft-film",
    label: "Craft Film",
    fields: ["eyebrow", "heading", "body", "video_path", "poster_path"],
    structured: "scenes",
  },
  {
    key: "collection",
    label: "Collection",
    fields: ["eyebrow", "heading", "body"],
  },
  {
    key: "process",
    label: "Process",
    fields: ["eyebrow", "heading", "body"],
    structured: "steps",
  },
  {
    key: "atelier",
    label: "Atelier",
    fields: ["eyebrow", "heading", "body", "image_path", "image_alt"],
    structured: "tags",
  },
  {
    key: "cta",
    label: "Call to Action",
    fields: ["eyebrow", "heading", "body", "button_label"],
  },
  {
    key: "faq",
    label: "FAQ",
    fields: ["eyebrow", "heading", "body"],
    structured: "items",
  },
];

export const CONTENT_FIELD_LABELS = {
  eyebrow: "Eyebrow",
  heading: "Heading",
  body: "Body",
  image_path: "Approved public image path",
  image_alt: "Image alternative text",
  primary_cta_label: "Primary button label",
  primary_cta_href: "Primary button link (same-site path or #fragment)",
  supporting_body: "Supporting copy",
  video_path: "Pexels video URL",
  poster_path: "Approved public poster image path",
  button_label: "Button label",
};

const REQUIRED_SECTION_KEYS = HOMEPAGE_SECTIONS.map((section) => section.key);
const IMAGE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const VIDEO_URL_PATTERN = /^https:\/\/videos[.]pexels[.]com\/video-files\/[0-9]+\/[A-Za-z0-9._-]+[.]mp4$/;
const VIDEO_SOURCE_PATTERN = /^https:\/\/www[.]pexels[.]com\/video\/[A-Za-z0-9-]+\/$/;
const CTA_HREF_PATTERN = /^#[A-Za-z][A-Za-z0-9_-]*$/;
const EMPTY_SCENE = {
  src: "",
  caption: "",
  label: "",
  title: "",
  sourcePage: "",
  seconds: "",
};

export function isHomepageManager(role) {
  return role === "owner" || role === "admin";
}

export function validateHomepageDraftStructure(sections) {
  const errors = [];
  if (!Array.isArray(sections)) return ["Sections must be an array."];
  if (sections.length !== REQUIRED_SECTION_KEYS.length) {
    errors.push("A draft must contain all eight homepage section records.");
  }
  const seenKeys = new Set();
  const seenOrders = new Set();
  for (const [index, section] of sections.entries()) {
    const key = section?.section_key;
    if (!REQUIRED_SECTION_KEYS.includes(key)) {
      errors.push(`Section ${index + 1} has an unsupported section key.`);
      continue;
    }
    if (seenKeys.has(key)) errors.push(`${key}: section key is duplicated.`);
    seenKeys.add(key);
    if (section.section_type !== key) errors.push(`${key}: section type must match its key.`);
    if (!section.content || typeof section.content !== "object" || Array.isArray(section.content)) {
      errors.push(`${key}: content must be a JSON object.`);
      continue;
    }
    if (typeof section.is_visible !== "boolean") errors.push(`${key}: visibility must be boolean.`);
    if (!Number.isInteger(section.sort_order) || section.sort_order < 0) {
      errors.push(`${key}: display order must be a non-negative integer.`);
    } else if (seenOrders.has(section.sort_order)) {
      errors.push(`${key}: display order is duplicated.`);
    } else {
      seenOrders.add(section.sort_order);
    }

    const definition = HOMEPAGE_SECTIONS.find((item) => item.key === key);
    for (const field of definition.fields) {
      if (typeof section.content[field] !== "string") {
        errors.push(`${key}: ${field} must be text.`);
      }
    }
    if (definition.structured === "steps" || definition.structured === "tags") {
      const value = section.content[definition.structured];
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        errors.push(`${key}: ${definition.structured} must be an array of text values.`);
      }
    }
    if (definition.structured === "scenes") {
      const scenes = section.content.scenes;
      if (!Array.isArray(scenes) || scenes.length !== 4) {
        errors.push(`${key}: scenes must contain exactly four objects.`);
      } else {
        scenes.forEach((scene, sceneIndex) => {
          if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
            errors.push(`${key}: scene ${sceneIndex + 1} must be an object.`);
            return;
          }
          for (const field of ["src", "caption", "label", "title", "sourcePage"]) {
            if (typeof scene[field] !== "string") errors.push(`${key}: scene ${sceneIndex + 1} ${field} must be text.`);
          }
          if ((typeof scene.seconds !== "number" || !Number.isFinite(scene.seconds)) &&
            scene.seconds !== "") {
            errors.push(`${key}: scene ${sceneIndex + 1} seconds must be a number or blank.`);
          }
        });
      }
    }
    if (definition.structured === "items") {
      const items = section.content.items;
      if (!Array.isArray(items) || items.length !== 4) {
        errors.push(`${key}: FAQ items must contain exactly four objects.`);
      } else {
        items.forEach((item, itemIndex) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            errors.push(`${key}: FAQ ${itemIndex + 1} must be an object.`);
          } else {
            for (const field of ["question", "answer"]) {
              if (typeof item[field] !== "string") errors.push(`${key}: FAQ ${itemIndex + 1} ${field} must be text.`);
            }
          }
        });
      }
    }
  }
  for (const key of REQUIRED_SECTION_KEYS) {
    if (!seenKeys.has(key)) errors.push(`${key}: section is missing.`);
  }
  return errors;
}

function isSafeImagePath(path) {
  return typeof path === "string" &&
    IMAGE_PATH_PATTERN.test(path) &&
    !/(^|\/)\.\.?($|\/)/.test(path) &&
    !path.includes("//") &&
    !path.endsWith("/") &&
    /\.(avif|jpe?g|png|webp)$/i.test(path);
}

function isSafeCtaHref(href) {
  return CTA_HREF_PATTERN.test(href) ||
    (href.startsWith("/") && !href.startsWith("//") &&
      !/[\s\u0000-\u001f]/.test(href) && !href.includes("\\") &&
      !/(^|\/)\.\.?($|\/)/.test(href));
}

export function collectHomepagePublishErrors(sections, productIds, products) {
  const errors = validateHomepageDraftStructure(sections);
  if (errors.length) return errors;
  const sectionByKey = new Map(sections.map((section) => [section.section_key, section]));
  const addRequiredTextErrors = (section, fields) => {
    for (const field of fields) {
      if (!section.content[field].trim()) {
        errors.push(`${section.section_key}: ${CONTENT_FIELD_LABELS[field] || field} is required.`);
      }
    }
  };
  for (const definition of HOMEPAGE_SECTIONS) {
    const section = sectionByKey.get(definition.key);
    addRequiredTextErrors(section, definition.fields);
    const content = section.content;
    if (["hero", "atelier"].includes(definition.key) &&
      !isSafeImagePath(content.image_path)) {
      errors.push(`${definition.label}: enter a safe, supported image path.`);
    }
    if (definition.key === "craft-film") {
      if (!isSafeImagePath(content.poster_path)) errors.push("Craft Film: enter a safe, supported poster image path.");
      if (!VIDEO_URL_PATTERN.test(content.video_path)) errors.push("Craft Film: enter an approved HTTPS Pexels video URL.");
      content.scenes.forEach((scene, index) => {
        const label = `Craft Film scene ${index + 1}`;
        for (const field of ["src", "caption", "label", "title", "sourcePage"]) {
          if (!scene[field].trim()) errors.push(`${label}: ${field} is required.`);
        }
        if (!VIDEO_URL_PATTERN.test(scene.src)) errors.push(`${label}: enter an approved HTTPS Pexels video URL.`);
        if (!VIDEO_SOURCE_PATTERN.test(scene.sourcePage)) errors.push(`${label}: enter a valid Pexels attribution URL.`);
        if (typeof scene.seconds !== "number" || !Number.isFinite(scene.seconds) || scene.seconds <= 0) {
          errors.push(`${label}: duration must be a positive number.`);
        }
      });
    }
    if (definition.key === "hero" && !isSafeCtaHref(content.primary_cta_href)) {
      errors.push("Hero: use a same-site path or a simple #fragment for the primary button link.");
    }
    if (definition.key === "process" &&
      (content.steps.length !== 4 || content.steps.some((step) => !step.trim()))) {
      errors.push("Process: provide exactly four non-empty steps.");
    }
    if (definition.key === "faq" &&
      (content.items.length !== 4 || content.items.some((item) =>
        !item.question.trim() || !item.answer.trim()))) {
      errors.push("FAQ: provide four questions and answers.");
    }
  }
  if (!sectionByKey.get("hero").is_visible) errors.push("Hero: the section must be visible to publish.");

  if (!Array.isArray(productIds) || productIds.length !== 8) {
    errors.push("Catalogue: select exactly eight homepage products.");
  } else {
    if (new Set(productIds).size !== 8) errors.push("Catalogue: product selections must be unique.");
    const productById = new Map((products || []).map((product) => [product.id, product]));
    productIds.forEach((id) => {
      const product = productById.get(id);
      if (!product) errors.push(`Catalogue: selected product ${id} is unavailable.`);
      else if (product.status !== "published" || product.homepage_visible !== true) {
        errors.push(`Catalogue: ${product.legacy_code || product.title || id} must be published and homepage-visible.`);
      }
    });
  }
  return errors;
}

export function emptySectionContent(key) {
  const section = HOMEPAGE_SECTIONS.find((item) => item.key === key);
  if (!section) throw new Error(`Unknown homepage section: ${key}`);
  const content = Object.fromEntries(section.fields.map((field) => [field, ""]));
  if (section.structured === "scenes") content.scenes = Array.from({ length: 4 }, () => ({ ...EMPTY_SCENE }));
  if (section.structured === "steps") content.steps = ["", "", "", ""];
  if (section.structured === "tags") content.tags = [];
  if (section.structured === "items") {
    content.items = Array.from({ length: 4 }, () => ({ question: "", answer: "" }));
  }
  return content;
}

export function formatHomepageError(error, operation) {
  if (error?.code === "40001") {
    return `This draft changed since you opened it. Your edits are still on screen. Reload the latest draft before saving or publishing.`;
  }
  if (error?.code === "42501") {
    return "Homepage editing is restricted to active Owner and Admin accounts.";
  }
  if (error?.code === "23514" || error?.code === "22023") {
    return error.message || `The homepage ${operation} was rejected. Check the required section content and product selection.`;
  }
  if (["PGRST202", "PGRST205", "42883", "42P01"].includes(error?.code)) {
    return "Homepage editing is unavailable because the Homepage Editor database migration or RPCs are not installed.";
  }
  return error?.message || `Could not ${operation} the homepage. Please try again.`;
}

function throwOnError(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function loadHomepageEditorData(client) {
  let release = throwOnError(await client.from("homepage_releases")
    .select("id,status,lock_version,created_at,updated_at")
    .eq("status", "draft")
    .maybeSingle());

  if (!release) {
    const releaseId = throwOnError(await client.rpc("create_homepage_draft"));
    if (typeof releaseId !== "string" || !releaseId) {
      throw new Error("The create_homepage_draft RPC did not return a release ID.");
    }
    release = throwOnError(await client.from("homepage_releases")
      .select("id,status,lock_version,created_at,updated_at")
      .eq("id", releaseId)
      .maybeSingle());
    if (!release) throw new Error("The homepage draft could not be loaded after creation.");
  }

  const [sectionRows, productRows, catalogueProducts] = await Promise.all([
    client.from("homepage_section_revisions")
      .select("section_key,section_type,content,is_visible,sort_order")
      .eq("release_id", release.id)
      .order("sort_order", { ascending: true }),
    client.from("homepage_release_products")
      .select("product_id,sort_order")
      .eq("release_id", release.id)
      .order("sort_order", { ascending: true }),
    client.from("products")
      .select("id,legacy_code,title,description,homepage_card_summary,status,homepage_visible,homepage_sort_order")
      .order("homepage_sort_order", { ascending: true }),
  ]);

  return {
    release,
    sections: throwOnError(sectionRows),
    selectedProducts: throwOnError(productRows),
    products: throwOnError(catalogueProducts),
  };
}

export async function saveHomepageDraft(client, release, sections, productIds) {
  if (!release?.id || !Number.isInteger(release.lock_version)) {
    throw new Error("The current draft version is unavailable. Reload the draft before saving.");
  }
  return throwOnError(await client.rpc("save_homepage_draft", {
    p_release_id: release.id,
    p_expected_version: release.lock_version,
    p_sections: sections,
    p_product_ids: productIds,
  }));
}

export async function publishHomepageDraft(client, release) {
  if (!release?.id || !Number.isInteger(release.lock_version)) {
    throw new Error("The current draft version is unavailable. Reload the draft before publishing.");
  }
  return throwOnError(await client.rpc("publish_homepage_release", {
    p_release_id: release.id,
    p_expected_version: release.lock_version,
  }));
}

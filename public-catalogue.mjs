import {
  isTrustedPreviewMessage,
  previewMessageTargetOrigin,
} from "./studio-preview-messaging.mjs";

const PRODUCT_FIELDS = "id,legacy_code,title,description,category_id,status,homepage_visible,lookbook_visible,homepage_sort_order";
const CATEGORY_FIELDS = "id,name,slug,sort_order";
const IMAGE_FIELDS = "id,product_id,bucket_id,storage_path,alt_text,caption,sort_order,approved_at";
const HOMEPAGE_SECTION_KEYS = [
  "hero", "introduction", "craft-film", "collection",
  "process", "atelier", "cta", "faq",
];
const SAFE_IMAGE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SAFE_VIDEO_URL = /^https:\/\/videos[.]pexels[.]com\/video-files\/[0-9]+\/[A-Za-z0-9._-]+[.]mp4$/;
const SAFE_VIDEO_SOURCE_URL = /^https:\/\/www[.]pexels[.]com\/video\/[A-Za-z0-9-]+\/$/;
let homepageDesignCardTemplate = null;

async function getRows(config, table, query) {
  const url = new URL(`/rest/v1/${table}`, config.url);
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, {
    headers: {
      apikey: config.publishableKey,
      Authorization: `Bearer ${config.publishableKey}`,
      Accept: "application/json",
    },
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Catalogue request failed (${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Catalogue response was not a list.");
  return data;
}

function isSafeImagePath(path) {
  return typeof path === "string" &&
    SAFE_IMAGE_PATH.test(path) &&
    !/(^|\/)\.\.?($|\/)/.test(path) &&
    !path.includes("//") &&
    !path.endsWith("/") &&
    /\.(avif|jpe?g|png|webp)$/i.test(path);
}

function publicImageUrl(config, path) {
  if (!isSafeImagePath(path)) return null;
  let base;
  try {
    base = new URL(config.url);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" || base.username || base.password) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return new URL(`/storage/v1/object/public/catalogue-public/${encoded}`, base).href;
}

function isSafeCtaHref(href) {
  return typeof href === "string" &&
    (/^#[A-Za-z][A-Za-z0-9_-]*$/.test(href) ||
      (href.startsWith("/") && !href.startsWith("//") &&
        !/[\s\u0000-\u001f]/.test(href) && !href.includes("\\") &&
        !/(^|\/)\.\.?($|\/)/.test(href)));
}

export function preparePublishedHomepage(release, sections, releaseProducts, products) {
  if (release?.status !== "published") return null;
  const sectionsByKey = new Map(
    sections
      .filter((section) => HOMEPAGE_SECTION_KEYS.includes(section.section_key) &&
        section.is_visible === true && section.section_type === section.section_key)
      .map((section) => [section.section_key, section]),
  );
  const visibleSections = [...sectionsByKey.values()]
    .sort((a, b) => a.sort_order - b.sort_order);
  const productsById = new Map(products.map((product) => [product.id, product]));
  const curatedProducts = [...releaseProducts]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(({ product_id }) => productsById.get(product_id))
    .filter((product) => product?.status === "published" && product.homepage_visible);
  return {
    sections: visibleSections,
    hiddenSectionKeys: HOMEPAGE_SECTION_KEYS.filter((key) => !sectionsByKey.has(key)),
    products: curatedProducts,
  };
}

export function prepareStudioHomepagePreview(sections, productIds, products) {
  if (!Array.isArray(sections) || sections.length !== HOMEPAGE_SECTION_KEYS.length ||
    !Array.isArray(productIds) || !Array.isArray(products)) return null;
  const keys = new Set();
  if (sections.some((section) => {
    if (!HOMEPAGE_SECTION_KEYS.includes(section?.section_key) ||
      section.section_type !== section.section_key || typeof section.is_visible !== "boolean" ||
      !Number.isInteger(section.sort_order) || !section.content || typeof section.content !== "object" ||
      keys.has(section.section_key)) return true;
    keys.add(section.section_key);
    return false;
  }) || keys.size !== HOMEPAGE_SECTION_KEYS.length ||
    productIds.some((id) => typeof id !== "string")) return null;
  const releaseProducts = productIds.map((product_id, sort_order) => ({ product_id, sort_order }));
  return preparePublishedHomepage({ status: "published" }, sections, releaseProducts, products);
}

async function loadPublishedHomepage(config) {
  const releases = await getRows(config, "homepage_releases", {
    select: "id,status,published_at",
    status: "eq.published",
    limit: "1",
  });
  const release = releases[0];
  if (!release) return null;

  const [sections, releaseProducts] = await Promise.all([
    getRows(config, "homepage_section_revisions", {
      select: "section_key,section_type,content,is_visible,sort_order",
      release_id: `eq.${release.id}`,
      is_visible: "eq.true",
      order: "sort_order.asc",
    }),
    getRows(config, "homepage_release_products", {
      select: "product_id,sort_order",
      release_id: `eq.${release.id}`,
      order: "sort_order.asc",
    }),
  ]);
  const productIds = releaseProducts.map(({ product_id }) => product_id);
  const products = productIds.length
    ? await getRows(config, "products", {
      select: PRODUCT_FIELDS,
      id: `in.(${productIds.join(",")})`,
      status: "eq.published",
      homepage_visible: "eq.true",
    })
    : [];
  return { release, sections, releaseProducts, products };
}

function setText(element, value) {
  if (element && typeof value === "string") element.textContent = value;
}

function appendFormattedHeadingLine(nodes, line) {
  const emphasis = /\*([^*\r\n]+)\*/g;
  let start = 0;
  for (const match of line.matchAll(emphasis)) {
    if (match.index > start) nodes.push(document.createTextNode(line.slice(start, match.index)));
    const element = document.createElement("em");
    element.append(document.createTextNode(match[1]));
    nodes.push(element);
    start = match.index + match[0].length;
  }
  if (start < line.length || !nodes.length) {
    nodes.push(document.createTextNode(line.slice(start)));
  }
}

function setFormattedHeading(element, value) {
  if (!element || typeof value !== "string") return;
  const nodes = [];
  value.split(/\r\n?|\n/).forEach((line, index) => {
    if (index > 0) nodes.push(document.createElement("br"));
    appendFormattedHeadingLine(nodes, line);
  });
  element.replaceChildren(...nodes);
}

function setButtonLabel(button, value) {
  if (!button || typeof value !== "string") return;
  const arrow = button.querySelector(".arrow");
  button.replaceChildren(document.createTextNode(`${value} `));
  if (arrow) button.append(arrow);
}

function setPublicImage(image, config, path, alt) {
  const url = publicImageUrl(config, path);
  if (!image || !url) return;
  image.src = url;
  image.alt = typeof alt === "string" ? alt : "";
}

function safeStagingPreviewUrl(config, value) {
  if (typeof value !== "string") return null;
  try {
    const project = new URL(config.url);
    const candidate = new URL(value);
    if (project.protocol !== "https:" || project.username || project.password ||
      candidate.origin !== project.origin ||
      !candidate.pathname.startsWith("/storage/v1/object/sign/catalogue-staging/") ||
      !candidate.searchParams.has("token")) return null;
    return candidate.href;
  } catch {
    return null;
  }
}

export function renderPublishedHomepage(homepage, config, previewImageUrls = {}) {
  const main = document.querySelector("#main-content");
  const sectionElements = new Map(
    [...main.querySelectorAll("[data-homepage-section]")]
      .map((section) => [section.dataset.homepageSection, section]),
  );
  const contentByKey = new Map(homepage.sections.map((section) => [section.section_key, section.content]));

  homepage.hiddenSectionKeys.forEach((key) => {
    const section = sectionElements.get(key);
    if (section) section.hidden = true;
  });
  homepage.sections.forEach(({ section_key: key }) => {
    const section = sectionElements.get(key);
    if (section) section.hidden = false;
  });
  const orderedSections = [
    ...homepage.sections.map(({ section_key: key }) => sectionElements.get(key)),
    ...homepage.hiddenSectionKeys.map((key) => sectionElements.get(key)),
  ].filter(Boolean);
  main.append(...orderedSections);

  const get = (key, selector) => sectionElements.get(key)?.querySelector(selector);
  const hero = contentByKey.get("hero");
  if (hero) {
    setText(get("hero", ".eyebrow"), hero.eyebrow);
    setFormattedHeading(get("hero", "h1"), hero.heading);
    setText(get("hero", ".hero-copy"), hero.body);
    setPublicImage(get("hero", ".hero-image img"), config, hero.image_path, hero.image_alt);
    const link = get("hero", ".hero-actions a.button.light");
    setButtonLabel(link, hero.primary_cta_label);
    if (link && isSafeCtaHref(hero.primary_cta_href)) link.href = hero.primary_cta_href;
  }

  const introduction = contentByKey.get("introduction");
  if (introduction) {
    setText(get("introduction", ".kicker"), introduction.eyebrow);
    setFormattedHeading(get("introduction", ".large-copy"), introduction.heading);
    setText(get("introduction", ".intro-note"),
      [introduction.body, introduction.supporting_body].filter(Boolean).join(" "));
  }

  const craftFilm = contentByKey.get("craft-film");
  if (craftFilm) {
    setText(get("craft-film", ".kicker"), craftFilm.eyebrow);
    setFormattedHeading(get("craft-film", ".film-copy h2"), craftFilm.heading);
    setText(get("craft-film", ".film-copy > p"), craftFilm.body);
    const video = get("craft-film", "#stitch-film");
    const posterUrl = publicImageUrl(config, craftFilm.poster_path);
    if (video && posterUrl) video.poster = posterUrl;
    if (Array.isArray(craftFilm.scenes) && craftFilm.scenes.length === 4 &&
      craftFilm.scenes.every((scene) => SAFE_VIDEO_URL.test(scene.src) &&
        SAFE_VIDEO_SOURCE_URL.test(scene.sourcePage) &&
        typeof scene.caption === "string" && typeof scene.label === "string" &&
        typeof scene.title === "string" && Number.isFinite(scene.seconds) && scene.seconds > 0)) {
      window.dispatchEvent(new CustomEvent("cfp:homepage-film-scenes", {
        detail: craftFilm.scenes,
      }));
    }
  }

  const collection = contentByKey.get("collection");
  if (collection) {
    setText(get("collection", ".section-head .kicker"), collection.eyebrow);
    setFormattedHeading(get("collection", ".section-head h2"), collection.heading);
    setText(get("collection", ".section-head p"), collection.body);
  }

  const process = contentByKey.get("process");
  if (process) {
    setText(get("process", ".process-head .kicker"), process.eyebrow);
    setFormattedHeading(get("process", ".process-head h2"), process.heading);
    setText(get("process", ".process-head p"), process.body);
    get("process", ".process-grid")?.querySelectorAll(".process-step").forEach((step, index) => {
      setText(step.querySelector("h3"), process.steps?.[index] || "");
    });
  }

  const atelier = contentByKey.get("atelier");
  if (atelier) {
    setPublicImage(get("atelier", ".atelier-photo img"), config, atelier.image_path, atelier.image_alt);
    setText(get("atelier", ".atelier-copy .kicker"), atelier.eyebrow);
    setFormattedHeading(get("atelier", ".atelier-copy h2"), atelier.heading);
    setText(get("atelier", ".atelier-copy > p"), atelier.body);
    const tags = get("atelier", ".craft-tags");
    if (tags && Array.isArray(atelier.tags)) {
      tags.replaceChildren(...atelier.tags.filter((tag) => typeof tag === "string").map((tag) => {
        const element = document.createElement("span");
        element.textContent = tag;
        return element;
      }));
    }
  }

  const cta = contentByKey.get("cta");
  if (cta) {
    setText(get("cta", ".kicker"), cta.eyebrow);
    setFormattedHeading(get("cta", "h2"), cta.heading);
    setText(get("cta", ".cta-inner > div:last-child p"), cta.body);
    setButtonLabel(get("cta", "[data-book]"), cta.button_label);
  }

  const faq = contentByKey.get("faq");
  if (faq) {
    setText(get("faq", ".section-head .kicker"), faq.eyebrow);
    setFormattedHeading(get("faq", ".section-head h2"), faq.heading);
    setText(get("faq", ".section-head p"), faq.body);
    const list = get("faq", ".faq-list");
    const template = list?.querySelector(".faq-item");
    if (list && template && Array.isArray(faq.items)) {
      const items = faq.items.filter((item) =>
        item && typeof item.question === "string" && typeof item.answer === "string")
        .map((item) => {
          const element = template.cloneNode(true);
          const summary = element.querySelector("summary");
          const marker = summary.querySelector("span");
          summary.replaceChildren(document.createTextNode(item.question), marker);
          setText(element.querySelector(".faq-item > div p"), item.answer);
          return element;
        });
      list.replaceChildren(...items);
    }
  }

  const setDraftImagePreview = (sectionKey, field, selector, isVideo = false) => {
    const section = contentByKey.get(sectionKey);
    const url = section && safeStagingPreviewUrl(config, previewImageUrls[section[field]]);
    const element = get(sectionKey, selector);
    if (!element || !url) return;
    if (isVideo) element.poster = url;
    else element.src = url;
  };
  setDraftImagePreview("hero", "image_path", ".hero-image img");
  setDraftImagePreview("atelier", "image_path", ".atelier-photo img");
  setDraftImagePreview("craft-film", "poster_path", "#stitch-film", true);
}

function setCardContent(card, product, category, image, index, lookbook = false, total = 1) {
  const imageUrl = publicImageUrl(window.CFP_SUPABASE_CONFIG, image.storage_path);
  const type = category?.name || "Custom design";
  const description = product.description || "";
  const id = product.legacy_code;
  const alt = image.alt_text || `${product.title} design`;
  delete card.dataset.interactionsBound;
  card.dataset.id = id;
  card.dataset.title = product.title;
  card.dataset.image = imageUrl;
  card.dataset.type = type;
  card.dataset.description = description;
  card.dataset.category = category?.slug || "";
  if (lookbook) card.dataset.category = category?.slug || "uncategorised";
  const img = card.querySelector(".design-image img");
  img.src = imageUrl;
  img.alt = alt;
  img.loading = "lazy";
  const title = card.querySelector(".card-info h3");
  if (title) title.textContent = product.title;
  const detail = card.querySelector(".card-info p");
  if (detail) detail.textContent = description || type;
  const cardCode = card.querySelector(".code, .card-code");
  if (cardCode) cardCode.textContent = id.replace("-", "—");
  const label = card.querySelector(".card-bottom span, .design-badge");
  if (label) label.textContent = lookbook ? type : type;
  const number = card.querySelector(".design-num");
  if (number) number.textContent = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  if (card.classList.contains("reveal")) card.classList.add("in-view");
  const saveButton = card.querySelector(".pin-btn, .save-btn");
  if (saveButton) saveButton.setAttribute("aria-label", `Save ${product.title}`);
  const viewButton = card.querySelector(".view-design, .view-btn");
  if (viewButton) viewButton.setAttribute("aria-label", `View ${product.title}`);
}

function makeFilterButton(className, slug, name, count = null) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.filter = slug;
  button.setAttribute("aria-pressed", slug === "all" ? "true" : "false");
  if (slug === "all") button.classList.add("active");
  button.append(document.createTextNode(name));
  if (count !== null) {
    const span = document.createElement("span");
    span.textContent = String(count);
    button.append(" ", span);
  }
  return button;
}

export function selectVisibleCatalogue(products, categories, images, destination) {
  if (!["homepage", "lookbook"].includes(destination)) {
    throw new Error("Choose a supported public catalogue destination.");
  }
  const visibilityField = destination === "homepage" ? "homepage_visible" : "lookbook_visible";
  const categoryMap = new Map(categories
    .filter((category) => category.active !== false)
    .map((category) => [category.id, category]));
  const imageMap = new Map();
  images.forEach((image) => {
    if (image.bucket_id !== "catalogue-public" || !image.approved_at ||
      !isSafeImagePath(image.storage_path)) return;
    const current = imageMap.get(image.product_id);
    if (!current || image.sort_order < current.sort_order ||
      (image.sort_order === current.sort_order && image.id.localeCompare(current.id) < 0)) {
      imageMap.set(image.product_id, image);
    }
  });
  const visible = products.filter((product) =>
    product.status === "published" &&
    product[visibilityField] &&
    imageMap.has(product.id) &&
    (destination === "homepage"
      ? !product.category_id || categoryMap.has(product.category_id)
      : Boolean(product.category_id && categoryMap.has(product.category_id))));
  return { categoryMap, imageMap, visible };
}

function renderHomepage(products, categories, images) {
  const grid = document.querySelector("#design-grid");
  const filterBar = document.querySelector(".collection-filters");
  if (!homepageDesignCardTemplate) {
    const template = grid.querySelector(".design-card");
    if (!template) throw new Error("The homepage design-card template is missing.");
    homepageDesignCardTemplate = template.cloneNode(true);
  }
  const template = homepageDesignCardTemplate;
  const { categoryMap, imageMap, visible } =
    selectVisibleCatalogue(products, categories, images, "homepage");

  const cards = visible.map((product, index) => {
    const card = template.cloneNode(true);
    const category = categoryMap.get(product.category_id);
    card.dataset.category = category?.slug || "";
    setCardContent(card, product, category, imageMap.get(product.id), index, false, visible.length);
    return card;
  });
  grid.replaceChildren(...cards);
  const categoryCounts = new Map();
  visible.forEach((product) => {
    if (product.category_id && categoryMap.has(product.category_id)) {
      const slug = categoryMap.get(product.category_id).slug;
      categoryCounts.set(slug, (categoryCounts.get(slug) || 0) + 1);
    }
  });
  const filters = [makeFilterButton("filter-btn", "all", "All designs")];
  categories.forEach((category) => {
    if (categoryCounts.has(category.slug)) {
      filters.push(makeFilterButton("filter-btn", category.slug, category.name));
    }
  });
  filterBar.replaceChildren(...filters);
  let empty = document.querySelector("#public-catalogue-empty");
  if (!cards.length) {
    if (!empty) {
      empty = document.createElement("p");
      empty.id = "public-catalogue-empty";
      empty.className = "public-catalogue-empty";
      grid.after(empty);
    }
    empty.textContent = "New designs are being prepared for the collection.";
  } else {
    empty?.remove();
  }
  window.dispatchEvent(new CustomEvent("cfp:catalogue-updated"));
}

function renderLookbook(products, categories, images) {
  const gallery = document.querySelector("#design-gallery");
  const groups = [...gallery.querySelectorAll(".category-block")];
  const groupTemplate = groups[0];
  const cardTemplate = groupTemplate.querySelector(".design-card");
  const { categoryMap, imageMap, visible } =
    selectVisibleCatalogue(products, categories, images, "lookbook");

  const grouped = new Map(categories.map((category) => [category.id, []]));
  visible.forEach((product) => grouped.get(product.category_id).push(product));

  groups.forEach((group) => group.remove());
  const chapterLinks = document.querySelector(".chapter-links");
  const filters = document.querySelector(".filters");
  const generatedGroups = [];
  const generatedLinks = [];
  const categoryButtons = [makeFilterButton("filter", "all", "All designs", visible.length)];

  categories.forEach((category, groupIndex) => {
    const categoryProducts = grouped.get(category.id);
    if (!categoryProducts?.length) return;
    categoryProducts.sort((a, b) =>
      imageMap.get(a.id).sort_order - imageMap.get(b.id).sort_order || a.title.localeCompare(b.title));
    const id = `public-category-${category.slug}`;
    const titleId = `${id}-title`;
    const group = groupTemplate.cloneNode(true);
    group.id = id;
    group.dataset.chapter = category.slug;
    group.setAttribute("aria-labelledby", titleId);
    const heading = group.querySelector(".category-head");
    const chapter = heading.querySelector(".chapter-number");
    chapter.textContent = `${String(groupIndex + 1).padStart(2, "0")} / ${category.name.toLocaleUpperCase()}`;
    const title = heading.querySelector("h2");
    title.id = titleId;
    title.replaceChildren(document.createTextNode(category.name));
    const description = heading.querySelector("p");
    description.textContent = "";
    heading.querySelector(".category-count").textContent = `${String(categoryProducts.length).padStart(2, "0")} DESIGNS`;
    const grid = group.querySelector(".design-grid");
    const cards = categoryProducts.map((product, index) => {
      const card = cardTemplate.cloneNode(true);
      setCardContent(card, product, category, imageMap.get(product.id), index, true, categoryProducts.length);
      return card;
    });
    grid.replaceChildren(...cards);
    generatedGroups.push(group);
    const link = document.createElement("a");
    link.href = `#${id}`;
    link.append(document.createTextNode(category.name));
    const count = document.createElement("span");
    count.textContent = String(categoryProducts.length).padStart(2, "0");
    link.append(" ", count);
    generatedLinks.push(link);
    categoryButtons.push(makeFilterButton("filter", category.slug, category.name));
  });
  gallery.querySelector("#gallery-status").before(...generatedGroups);
  chapterLinks.replaceChildren(...generatedLinks);
  filters.replaceChildren(...categoryButtons);
  const footerChapterLink = document.querySelector('.footer-links a[href="#classic-necklines"]');
  if (footerChapterLink) {
    if (generatedGroups.length) {
      footerChapterLink.href = `#${generatedGroups[0].id}`;
      footerChapterLink.textContent = categories.find((category) => `public-category-${category.slug}` === generatedGroups[0].id).name;
      footerChapterLink.hidden = false;
    } else {
      footerChapterLink.hidden = true;
    }
  }
  const footerNote = document.querySelector(".footer-bottom span:last-child");
  if (footerNote) footerNote.textContent = visible.length
    ? `Design inspiration gallery · ${visible.length} approved boards`
    : "Design inspiration gallery · Awaiting approved catalogue images";
  document.querySelector(".gallery-head-burgundy p").textContent = visible.length
    ? `Explore ${visible.length} approved design boards. Browse by category, save the looks you love and prepare a personal fitting enquiry.`
    : "The design archive is being curated. Browse approved design boards, save the looks you love and prepare a personal fitting enquiry.";
  const imageIntegrity = gallery.querySelector(".gallery-footer strong");
  if (imageIntegrity) {
    imageIntegrity.parentElement.textContent =
      "Only approved catalogue images are displayed here. Product and image descriptions are provided by the studio.";
  }
  const uploadBatch = gallery.querySelector(".gallery-footer span:last-child");
  if (uploadBatch) uploadBatch.textContent = `${String(visible.length).padStart(2, "0")} APPROVED BOARDS`;
  let empty = document.querySelector("#public-catalogue-empty");
  if (!visible.length) {
    if (!empty) {
      empty = document.createElement("p");
      empty.id = "public-catalogue-empty";
      empty.className = "public-catalogue-empty";
      gallery.querySelector("#gallery-status").after(empty);
    }
    empty.textContent = "New design boards are being prepared for the lookbook.";
  } else {
    empty?.remove();
  }
  window.dispatchEvent(new CustomEvent("cfp:catalogue-updated"));
}

function isStudioPreview() {
  return new URLSearchParams(window.location.search).get("cfpStudioPreview") === "1" &&
    window.parent !== window;
}

export function buildStudioPreviewSelection(sectionKey, target) {
  const isElement = target && typeof target.closest === "function";
  const image = isElement ? target.closest("img") : null;
  const video = isElement ? target.closest("video") : null;
  const imageField = image && (
    sectionKey === "hero" && image.matches(".hero-image img") ||
    sectionKey === "atelier" && image.matches(".atelier-photo img")
  ) ? "image_path" : video?.id === "stitch-film" && video.paused ? "poster_path" : null;

  return {
    imageAlt: imageField && image ? image.alt : "",
    imageCurrentSrc: imageField
      ? image ? image.currentSrc || image.src : video.poster
      : "",
    imageField,
    preventDefault: !video,
  };
}

function enableStudioSectionSelection() {
  if (!isStudioPreview()) return;
  let latestRevision = 0;
  let cachedProductKey = null;
  let cachedCatalogue = null;
  let suppressNextClick = false;
  const previewStyle = document.createElement("style");
  previewStyle.textContent = "[data-homepage-section]{cursor:pointer}.studio-preview-selected{outline:2px solid #a98768;outline-offset:-2px}.hero:before{z-index:1;pointer-events:none}.hero-image{z-index:0}.hero-content{z-index:2;pointer-events:none}.hero-content>*{pointer-events:auto}";
  document.head.append(previewStyle);
  const handleStudioSelection = (event) => {
    const target = event.target && typeof event.target.closest === "function" ? event.target : null;
    if (!target) return;
    const section = target.closest("[data-homepage-section]");
    if (!section) return;
    const sectionKey = section.dataset.homepageSection;
    const selection = buildStudioPreviewSelection(sectionKey, target);
    if (selection.preventDefault) event.preventDefault();
    window.parent.postMessage({
      type: "cfp:homepage-section-selected",
      sectionKey,
      imageField: selection.imageField,
      imageCurrentSrc: selection.imageCurrentSrc,
      imageAlt: selection.imageAlt,
    }, previewMessageTargetOrigin(window.location));
  };

  document.addEventListener("pointerup", (event) => {
    if (event.button !== 0) return;
    suppressNextClick = true;
    window.setTimeout(() => { suppressNextClick = false; }, 0);
    handleStudioSelection(event);
  }, true);
  document.addEventListener("click", (event) => {
    if (suppressNextClick) return;
    handleStudioSelection(event);
  }, true);

  window.addEventListener("message", async (event) => {
    if (!isTrustedPreviewMessage(event, window.parent, window.location) ||
      event.data?.type !== "cfp:studio-homepage-draft") return;
    const { sections, productIds, products, imagePreviewUrls } = event.data;
    const revision = event.data.previewRevision;
    if (!Number.isInteger(revision) || revision <= latestRevision) return;
    latestRevision = revision;
    try {
      const homepage = prepareStudioHomepagePreview(sections, productIds, products);
      if (!homepage) {
        window.parent.postMessage(
          { type: "cfp:studio-homepage-preview-error", previewRevision: revision },
          previewMessageTargetOrigin(window.location),
        );
        return;
      }
      const productIdsToLoad = homepage.products.map((product) => product.id);
      const productKey = productIdsToLoad.join(",");
      if (event.data.refreshCatalogue === true) {
        cachedCatalogue = null;
        cachedProductKey = null;
      }
      if (!cachedCatalogue || productKey !== cachedProductKey) {
        const [categories, images] = await Promise.all([
          getRows(window.CFP_SUPABASE_CONFIG, "categories", {
            select: CATEGORY_FIELDS,
            active: "eq.true",
            order: "sort_order.asc,name.asc",
          }),
          productIdsToLoad.length
            ? getRows(window.CFP_SUPABASE_CONFIG, "product_images", {
              select: IMAGE_FIELDS,
              product_id: `in.(${productIdsToLoad.join(",")})`,
              bucket_id: "eq.catalogue-public",
              approved_at: "not.is.null",
              order: "sort_order.asc",
            })
            : Promise.resolve([]),
        ]);
        if (revision !== latestRevision) return;
        cachedCatalogue = { categories, images };
        cachedProductKey = productKey;
      }
      if (revision !== latestRevision) return;
      const { categories, images } = cachedCatalogue;
      renderPublishedHomepage(homepage, window.CFP_SUPABASE_CONFIG, imagePreviewUrls);
      renderHomepage(homepage.products, categories, images);
      document.querySelectorAll("[data-homepage-section]").forEach((section) => {
        section.classList.toggle(
          "studio-preview-selected",
          section.dataset.homepageSection === event.data.selectedSectionKey,
        );
      });
      window.parent.postMessage(
        { type: "cfp:studio-homepage-preview-ready", previewRevision: revision },
        previewMessageTargetOrigin(window.location),
      );
    } catch (error) {
      console.warn("The homepage draft preview could not be refreshed.", error);
      if (revision === latestRevision) {
        window.parent.postMessage(
          { type: "cfp:studio-homepage-preview-error", previewRevision: revision },
          previewMessageTargetOrigin(window.location),
        );
      }
    }
  });
}

async function loadPublicCatalogue() {
  const page = document.body.dataset.publicCatalogue;
  const config = window.CFP_SUPABASE_CONFIG;
  if (!config?.url || !config?.publishableKey || !["homepage", "lookbook"].includes(page)) return;
  if (isStudioPreview()) return;
  let projectUrl;
  try {
    projectUrl = new URL(config.url);
  } catch {
    return;
  }
  if (projectUrl.protocol !== "https:" || projectUrl.username || projectUrl.password) return;
  try {
    const categoriesRequest = getRows(config, "categories", {
      select: CATEGORY_FIELDS,
      active: "eq.true",
      order: "sort_order.asc,name.asc",
    });
    const [categories, homepageRelease] = page === "homepage"
      ? await Promise.all([categoriesRequest, loadPublishedHomepage(config)])
      : [await categoriesRequest, null];
    let products;
    let homepageView = null;
    if (homepageRelease) {
      homepageView = preparePublishedHomepage(
        homepageRelease.release,
        homepageRelease.sections,
        homepageRelease.releaseProducts,
        homepageRelease.products,
      );
      if (!homepageView) throw new Error("The published homepage release could not be prepared.");
      products = homepageView.products;
    } else {
      products = await getRows(config, "products", {
        select: PRODUCT_FIELDS,
        status: "eq.published",
        [page === "homepage" ? "homepage_visible" : "lookbook_visible"]: "eq.true",
        order: page === "homepage" ? "homepage_sort_order.asc" : "legacy_code.asc",
      });
    }
    const productIds = products.map((product) => product.id);
    const images = productIds.length
      ? await getRows(config, "product_images", {
        select: IMAGE_FIELDS,
        product_id: `in.(${productIds.join(",")})`,
        bucket_id: "eq.catalogue-public",
        approved_at: "not.is.null",
        order: "sort_order.asc",
      })
      : [];
    if (page === "homepage") {
      if (homepageView) renderPublishedHomepage(homepageView, config);
      renderHomepage(products, categories, images);
    }
    else renderLookbook(products, categories, images);
  } catch (error) {
    console.warn("Public catalogue could not be loaded; keeping the existing page content.", error);
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  enableStudioSectionSelection();
  void loadPublicCatalogue();
}

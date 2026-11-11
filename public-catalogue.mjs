const PRODUCT_FIELDS = "id,legacy_code,title,description,category_id,status,homepage_visible,lookbook_visible,homepage_sort_order";
const CATEGORY_FIELDS = "id,name,slug,sort_order";
const IMAGE_FIELDS = "id,product_id,bucket_id,storage_path,alt_text,caption,sort_order,approved_at";

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

function publicImageUrl(config, path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${config.url.replace(/\/+$/, "")}/storage/v1/object/public/catalogue-public/${encoded}`;
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
    if (image.bucket_id !== "catalogue-public" || !image.approved_at) return;
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
  const template = grid.querySelector(".design-card");
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

async function loadPublicCatalogue() {
  const page = document.body.dataset.publicCatalogue;
  const config = window.CFP_SUPABASE_CONFIG;
  if (!config?.url || !config?.publishableKey || !["homepage", "lookbook"].includes(page)) return;
  try {
    const [categories, products] = await Promise.all([
      getRows(config, "categories", {
        select: CATEGORY_FIELDS,
        active: "eq.true",
        order: "sort_order.asc,name.asc",
      }),
      getRows(config, "products", {
        select: PRODUCT_FIELDS,
        status: "eq.published",
        [page === "homepage" ? "homepage_visible" : "lookbook_visible"]: "eq.true",
        order: page === "homepage" ? "homepage_sort_order.asc" : "legacy_code.asc",
      }),
    ]);
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
    if (page === "homepage") renderHomepage(products, categories, images);
    else renderLookbook(products, categories, images);
  } catch (error) {
    console.warn("Public catalogue could not be loaded; keeping the existing page content.", error);
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  void loadPublicCatalogue();
}

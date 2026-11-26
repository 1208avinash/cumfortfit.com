import {
  CONTENT_FIELD_LABELS,
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
import {
  filterCatalogueProducts,
  formatCatalogueError,
  loadCatalogueData,
  saveCatalogueProduct,
  setCatalogueProductArchived,
} from "./catalogue.mjs";
import {
  approveProductImage,
  filterCategories,
  formatContentError,
  hideProductImage,
  imagePreviewUrl,
  loadCategories,
  loadImageManagementData,
  replaceProductImage,
  saveCategory,
  setCategoryActive,
  setProductPublicVisibility,
  updateProductImage,
  uploadStagingImage,
  validateImageFile,
} from "./content-management.mjs";
import { HOMEPAGE_IMAGE_LIBRARY } from "./homepage-image-library.mjs";
import {
  isTrustedPreviewMessage,
  previewMessageTargetOrigin,
} from "../studio-preview-messaging.mjs";

(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const config = window.CFP_SUPABASE_CONFIG;
  const configured = Boolean(config?.url && config?.publishableKey &&
    !config.url.includes("YOUR_PROJECT_REF") && !config.publishableKey.includes("YOUR_SUPABASE"));
  const screens = ["setup-screen", "login-screen", "dashboard-screen"];
  const labels = {
    overview: "Overview",
    catalogue: "Catalogue",
    lookbook: "Lookbook",
    categories: "Categories",
    media: "Image approvals",
    content: "Site content",
    homepage: "Homepage Editor",
    team: "Team & access",
    activity: "Audit history",
  };
  let supabase = null;
  let activeRole = null;
  let activeUserId = null;
  let homepageData = null;
  let homepageDirty = false;
  let homepageConflict = false;
  let homepageBusy = false;
  let selectedHomepageSection = "hero";
  let editingHomepageSection = false;
  let homepagePreviewRevision = 0;
  let homepageImageField = null;
  let homepageImagePreviewUrls = new Map();
  let homepageImageUploadPreviewUrl = null;
  let homepageImageBusy = false;
  let catalogueData = null;
  let catalogueProduct = null;
  let catalogueBusy = false;
  let catalogueSaving = false;
  let lookbookSaving = false;
  let categoryData = null;
  let categoryEditing = null;
  let categoryBusy = false;
  let categorySaving = false;
  let mediaData = null;
  let mediaBusy = false;
  let mediaSaving = false;
  let replacingImage = null;
  let mediaPreviewUrl = null;

  function showScreen(id) {
    screens.forEach((screen) => { $("#" + screen).hidden = screen !== id; });
  }
  function message(text, target = "#login-message") {
    $(target).textContent = text || "";
  }
  function showLogin() {
    activeRole = null;
    activeUserId = null;
    homepageData = null;
    homepageDirty = false;
    homepageConflict = false;
    catalogueData = null;
    categoryData = null;
    categoryEditing = null;
    mediaData = null;
    showScreen("login-screen");
  }
  function showDashboard(user, role) {
    activeRole = role;
    activeUserId = user.id;
    $("#user-email").textContent = user.email || "Studio member";
    $("#user-role").textContent = role;
    document.querySelectorAll(".owner-only").forEach((el) => { el.hidden = role !== "owner"; });
    document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = !isHomepageManager(role); });
    showScreen("dashboard-screen");
  }
  async function resolveMembership(user) {
    const { data, error } = await supabase.from("admin_memberships")
      .select("role,active").eq("user_id", user.id).maybeSingle();
    if (error) throw new Error("Could not verify studio access. Confirm the approved database migration is installed.");
    if (!data || data.active !== true || !["owner", "admin", "editor"].includes(data.role)) {
      await supabase.auth.signOut();
      throw new Error("This account has no active CUSTOM FIT PRIME admin invitation.");
    }
    return data.role;
  }
  async function refreshSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) { showLogin(); return; }
    try {
      const role = await resolveMembership(data.session.user);
      showDashboard(data.session.user, role);
    } catch (error) {
      showLogin();
      message(error.message);
    }
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function setCatalogueMessage(text, kind = "error", target = "#catalogue-message") {
    const output = $(target);
    output.textContent = text || "";
    output.classList.toggle("success", kind === "success");
  }

  function catalogueCategoryName(categoryId) {
    if (!categoryId) return "Uncategorised";
    return catalogueData?.categories.find((category) => category.id === categoryId)?.name || "Unavailable category";
  }

  function renderCatalogueCategories() {
    const formCategory = $("#catalogue-category");
    const filterCategory = $("#catalogue-category-filter");
    formCategory.replaceChildren(makeElement("option", "", "No category"));
    formCategory.options[0].value = "";
    filterCategory.replaceChildren(makeElement("option", "", "All categories"));
    filterCategory.options[0].value = "all";
    catalogueData.categories.forEach((category) => {
      const suffix = category.active ? "" : " (inactive)";
      const formOption = makeElement("option", "", `${category.name}${suffix}`);
      formOption.value = category.id;
      formCategory.append(formOption);
      const filterOption = makeElement("option", "", `${category.name}${suffix}`);
      filterOption.value = category.id;
      filterCategory.append(filterOption);
    });
  }

  function renderCatalogueRows() {
    if (!catalogueData) return;
    const body = $("#catalogue-rows");
    body.replaceChildren();
    const filtered = filterCatalogueProducts(
      catalogueData?.products || [],
      $("#catalogue-search").value,
      $("#catalogue-status-filter").value,
      $("#catalogue-category-filter").value,
    );
    $("#catalogue-loading").hidden = true;
    $("#catalogue-error").hidden = true;
    $("#catalogue-table-wrap").hidden = filtered.length === 0;
    $("#catalogue-empty").hidden = filtered.length !== 0;
    $("#catalogue-empty").textContent = catalogueData.products.length
      ? "No products match these filters."
      : "No products yet. Select Add product to create the first catalogue entry.";

    filtered.forEach((product) => {
      const row = makeElement("tr", product.status === "archived" ? "catalogue-row archived" : "catalogue-row");
      const imageCell = makeElement("td", "catalogue-image-cell");
      const image = catalogueData.images.filter((item) => item.product_id === product.id)
        .sort((a, b) => {
          const aPublic = a.bucket_id === "catalogue-public" && Boolean(a.approved_at);
          const bPublic = b.bucket_id === "catalogue-public" && Boolean(b.approved_at);
          return Number(bPublic) - Number(aPublic) || a.sort_order - b.sort_order;
        })[0];
      if (image) {
        const preview = makeElement("img", "catalogue-product-image");
        preview.alt = image.alt_text || `${product.title} image`;
        preview.loading = "lazy";
        imageCell.append(preview);
        imagePreviewUrl(supabase, image).then((url) => {
          if (preview.isConnected) preview.src = url;
        }).catch(() => {
          preview.classList.add("image-unavailable");
          preview.alt = "Image preview unavailable";
          preview.title = "Image preview unavailable";
        });
      } else {
        imageCell.append(makeElement("span", "catalogue-image-empty", "No image"));
      }
      const details = makeElement("td", "catalogue-product-cell");
      details.append(makeElement("strong", "", product.title));
      details.append(makeElement("small", "", `${product.legacy_code} · /${product.slug}`));
      const category = makeElement("td", "", catalogueCategoryName(product.category_id));
      const type = makeElement("td", "", product.record_type === "orderable_product" ? "Orderable product" : "Design reference");
      const audience = makeElement("td", "", product.audience === "not_set" ? "Not set" : product.audience);
      const status = makeElement("td");
      status.append(makeElement("span", `catalogue-status status-${product.status}`, product.status));
      const updated = makeElement("td", "", product.updated_at ? new Date(product.updated_at).toLocaleDateString() : "—");
      const actions = makeElement("td", "catalogue-actions");
      const edit = makeElement("button", "catalogue-button", "Edit");
      edit.type = "button";
      edit.dataset.catalogueAction = "edit";
      edit.dataset.productId = product.id;
      actions.append(edit);
      if (activeRole === "owner" || activeRole === "admin") {
        const archive = makeElement("button", "catalogue-button catalogue-danger", product.status === "archived" ? "Restore" : "Archive");
        archive.type = "button";
        archive.dataset.catalogueAction = product.status === "archived" ? "restore" : "archive";
        archive.dataset.productId = product.id;
        actions.append(archive);
      }
      row.append(imageCell, details, category, type, audience, status, updated, actions);
      body.append(row);
    });
    const counts = catalogueData.products.reduce((summary, product) => {
      summary[product.status] = (summary[product.status] || 0) + 1;
      return summary;
    }, {});
    $("#catalogue-results-summary").textContent =
      `${catalogueData.products.length} existing product${catalogueData.products.length === 1 ? "" : "s"} · ` +
      `${counts.published || 0} published · ${counts.draft || 0} drafts · ${counts.archived || 0} archived`;
  }

  async function loadCatalogue(force = false) {
    if (catalogueBusy) return;
    if (catalogueData && !force) {
      renderCatalogueRows();
      return;
    }
    catalogueBusy = true;
    $("#catalogue-loading").hidden = false;
    $("#catalogue-error").hidden = true;
    $("#catalogue-empty").hidden = true;
    $("#catalogue-table-wrap").hidden = true;
    $("#catalogue-reload").disabled = true;
    setCatalogueMessage("");
    try {
      catalogueData = await loadCatalogueData(supabase);
      renderCatalogueCategories();
      renderCatalogueRows();
    } catch (error) {
      catalogueData = null;
      $("#catalogue-loading").hidden = true;
      $("#catalogue-error").hidden = false;
      $("#catalogue-error").textContent = formatCatalogueError(error, "load");
      setCatalogueMessage(formatCatalogueError(error, "load"));
    } finally {
      catalogueBusy = false;
      $("#catalogue-reload").disabled = false;
    }
  }

  async function renderLookbookRows() {
    if (!catalogueData) return;
    const grid = $("#lookbook-products");
    grid.replaceChildren();
    const query = $("#lookbook-search").value.trim().toLocaleLowerCase();
    const statusFilter = $("#lookbook-status-filter").value;
    const filtered = catalogueData.products.filter((product) => {
      const categoryName = catalogueCategoryName(product.category_id);
      const matchesSearch = !query || [
        product.title,
        product.legacy_code,
        product.slug,
        product.description,
        categoryName,
      ].some((value) => value?.toLocaleLowerCase().includes(query));
      return matchesSearch && (statusFilter === "all" || product.status === statusFilter);
    });
    $("#lookbook-loading").hidden = true;
    $("#lookbook-error").hidden = true;
    $("#lookbook-empty").hidden = filtered.length !== 0;
    $("#lookbook-empty").textContent = catalogueData.products.length
      ? "No products match these filters."
      : "No product records are available in this catalogue.";
    $("#lookbook-results-summary").textContent =
      `${filtered.length} of ${catalogueData.products.length} product${catalogueData.products.length === 1 ? "" : "s"}`;

    for (const product of filtered) {
      const card = makeElement("article", "lookbook-product-card");
      const media = makeElement("div", "lookbook-product-media");
      const image = catalogueData.images.filter((item) => item.product_id === product.id)
        .sort((a, b) => {
          const aPublic = a.bucket_id === "catalogue-public" && Boolean(a.approved_at);
          const bPublic = b.bucket_id === "catalogue-public" && Boolean(b.approved_at);
          return Number(bPublic) - Number(aPublic) || a.sort_order - b.sort_order;
        })[0];
      if (image) {
        const preview = makeElement("img");
        preview.alt = image.alt_text || `${product.title} image`;
        preview.loading = "lazy";
        media.append(preview);
        imagePreviewUrl(supabase, image).then((url) => {
          if (preview.isConnected) preview.src = url;
        }).catch(() => {
          preview.classList.add("image-unavailable");
          preview.alt = "Image preview unavailable";
        });
      } else {
        media.append(makeElement("span", "", "No image"));
      }

      const body = makeElement("div", "lookbook-product-body");
      const heading = makeElement("div", "lookbook-product-heading");
      heading.append(makeElement("h3", "", product.title));
      heading.append(makeElement("span", `catalogue-status status-${product.status}`, product.status));
      body.append(heading);
      body.append(makeElement("p", "lookbook-product-details",
        `${catalogueCategoryName(product.category_id)} · ${product.record_type === "orderable_product" ? "Orderable product" : "Design reference"}`));
      body.append(makeElement("p", "lookbook-product-code", product.legacy_code));

      const selection = makeElement("label", "lookbook-product-selection");
      const checkbox = makeElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(product.lookbook_visible);
      checkbox.disabled = product.status !== "published" || !["owner", "admin"].includes(activeRole);
      checkbox.dataset.lookbookProductId = product.id;
      selection.append(checkbox, document.createTextNode("Show in public Lookbook"));
      body.append(selection);
      if (product.status !== "published") {
        body.append(makeElement("small", "lookbook-product-note", "Publish this product before adding it to the public Lookbook."));
      } else if (checkbox.disabled) {
        body.append(makeElement("small", "lookbook-product-note", "Only Owner and Admin roles can change public visibility."));
      }
      card.append(media, body);
      grid.append(card);
    }
  }

  async function loadLookbookView(force = false) {
    if (catalogueBusy) return;
    if (catalogueData && !force) {
      await renderLookbookRows();
      return;
    }
    catalogueBusy = true;
    $("#lookbook-loading").hidden = false;
    $("#lookbook-error").hidden = true;
    $("#lookbook-empty").hidden = true;
    $("#lookbook-products").replaceChildren();
    $("#lookbook-reload").disabled = true;
    setCatalogueMessage("", "error", "#lookbook-message");
    try {
      catalogueData = await loadCatalogueData(supabase);
      renderCatalogueCategories();
      await renderLookbookRows();
    } catch (error) {
      catalogueData = null;
      $("#lookbook-loading").hidden = true;
      $("#lookbook-error").hidden = false;
      $("#lookbook-error").textContent = formatCatalogueError(error, "load");
      setCatalogueMessage(formatCatalogueError(error, "load"), "error", "#lookbook-message");
    } finally {
      catalogueBusy = false;
      $("#lookbook-reload").disabled = false;
    }
  }

  async function changeLookbookVisibility(checkbox) {
    if (lookbookSaving || !catalogueData) return;
    const product = catalogueData.products.find((item) => item.id === checkbox.dataset.lookbookProductId);
    if (!product) {
      setCatalogueMessage("That product is no longer available. Reload the Lookbook list.", "error", "#lookbook-message");
      return;
    }
    lookbookSaving = true;
    checkbox.disabled = true;
    try {
      const updated = await setProductPublicVisibility(
        supabase, product, "lookbook_visible", checkbox.checked, activeRole,
      );
      Object.assign(product, updated);
      setCatalogueMessage("Lookbook selection saved.", "success", "#lookbook-message");
    } catch (error) {
      checkbox.checked = Boolean(product.lookbook_visible);
      setCatalogueMessage(error.message || "Could not update Lookbook selection.", "error", "#lookbook-message");
    } finally {
      checkbox.disabled = product.status !== "published" || !["owner", "admin"].includes(activeRole);
      lookbookSaving = false;
    }
  }

  function openCatalogueForm(product = null) {
    catalogueProduct = product;
    const form = $("#catalogue-form");
    form.reset();
    form.dataset.productId = product?.id || "";
    $("#catalogue-form-title").textContent = product ? "Edit product" : "Add product";
    $("#catalogue-form-panel").hidden = false;
    $("#catalogue-form-message").textContent = "";
    $("#catalogue-save").disabled = false;

    form.elements.legacy_code.value = product?.legacy_code || "";
    form.elements.slug.value = product?.slug || "";
    form.elements.title.value = product?.title || "";
    form.elements.description.value = product?.description || "";
    form.elements.record_type.value = product?.record_type || "design_reference";
    form.elements.audience.value = product?.audience || "not_set";
    form.elements.category_id.value = product?.category_id || "";
    const status = form.elements.status;
    const archivedOption = [...status.options].find((option) => option.value === "archived");
    if (product?.status === "archived" && !archivedOption) {
      const option = makeElement("option", "", "Archived");
      option.value = "archived";
      status.append(option);
    } else if (product?.status !== "archived" && archivedOption) {
      archivedOption.remove();
    }
    status.value = product?.status === "archived" ? "archived" : (product?.status || "draft");
    const manager = activeRole === "owner" || activeRole === "admin";
    const archived = product?.status === "archived";
    form.elements.legacy_code.disabled = Boolean(product && !manager);
    form.elements.slug.disabled = Boolean(product && !manager);
    form.elements.record_type.disabled = Boolean(product && !manager);
    status.disabled = !manager || archived;
    $("#catalogue-status-field").hidden = !manager && !product;
    if (!manager && !product) status.value = "draft";
    form.elements.title.focus();
  }

  function closeCatalogueForm() {
    $("#catalogue-form-panel").hidden = true;
    catalogueProduct = null;
  }

  function slugFromTitle(value) {
    return value.normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  async function submitCatalogueForm(event) {
    event.preventDefault();
    if (catalogueBusy || catalogueSaving) return;
    catalogueSaving = true;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    values.status = form.elements.status.value;
    const button = $("#catalogue-save");
    button.disabled = true;
    $("#catalogue-form-message").textContent = "";
    try {
      const saved = await saveCatalogueProduct(supabase, values, activeRole, catalogueProduct);
      const wasEditing = Boolean(catalogueProduct);
      closeCatalogueForm();
      await loadCatalogue(true);
      if (catalogueData) setCatalogueMessage(`${saved.title} ${wasEditing ? "updated" : "added"} successfully.`, "success");
    } catch (error) {
      $("#catalogue-form-message").textContent = formatCatalogueError(error, "save");
    } finally {
      catalogueSaving = false;
      button.disabled = false;
    }
  }

  async function runCatalogueAction(product, action) {
    const restoring = action === "restore";
    const prompt = restoring
      ? `Restore “${product.title}” as a draft?`
      : `Archive “${product.title}”? It will be removed from homepage, lookbook, and public pricing visibility.`;
    if (!window.confirm(prompt)) return;
    try {
      await setCatalogueProductArchived(supabase, product, activeRole, !restoring);
      closeCatalogueForm();
      await loadCatalogue(true);
      if (catalogueData) {
        setCatalogueMessage(restoring
          ? `${product.title} restored as a draft.`
          : `${product.title} archived.`, "success");
      }
    } catch (error) {
      setCatalogueMessage(formatCatalogueError(error, restoring ? "restore" : "archive"));
    }
  }

      function setManagedMessage(text, kind = "error", target = "#category-message") {
        const output = $(target);
        output.textContent = text || "";
        output.classList.toggle("success", kind === "success");
      }

      function renderCategoryRows() {
        if (!categoryData) return;
        const body = $("#category-rows");
        body.replaceChildren();
        const filtered = filterCategories(categoryData, $("#category-search").value, $("#category-status-filter").value);
        $("#category-loading").hidden = true;
        $("#category-error").hidden = true;
        $("#category-table-wrap").hidden = filtered.length === 0;
        $("#category-empty").hidden = filtered.length !== 0;
        filtered.forEach((category) => {
          const row = makeElement("tr", category.active ? "" : "managed-inactive");
          row.append(makeElement("td", "", category.name));
          row.append(makeElement("td", "", category.slug));
          row.append(makeElement("td", "", String(category.sort_order)));
          row.append(makeElement("td", "", category.active ? "Active" : "Inactive"));
          const actions = makeElement("td", "catalogue-actions");
          const edit = makeElement("button", "catalogue-button", "Edit");
          edit.type = "button";
          edit.dataset.categoryAction = "edit";
          edit.dataset.categoryId = category.id;
          actions.append(edit);
          const toggle = makeElement("button", "catalogue-button", category.active ? "Deactivate" : "Restore");
          toggle.type = "button";
          toggle.dataset.categoryAction = category.active ? "deactivate" : "restore";
          toggle.dataset.categoryId = category.id;
          actions.append(toggle);
          row.append(actions);
          body.append(row);
        });
      }

      async function loadCategoryView(force = false) {
        if (categoryBusy) return;
        if (categoryData && !force) {
          renderCategoryRows();
          return;
        }
        categoryBusy = true;
        $("#category-loading").hidden = false;
        $("#category-error").hidden = true;
        $("#category-empty").hidden = true;
        $("#category-table-wrap").hidden = true;
        $("#category-reload").disabled = true;
        setManagedMessage("");
        try {
          categoryData = await loadCategories(supabase);
          renderCategoryRows();
        } catch (error) {
          categoryData = null;
          $("#category-loading").hidden = true;
          $("#category-error").hidden = false;
          $("#category-error").textContent = formatContentError(error, "load");
          setManagedMessage(formatContentError(error, "load"));
        } finally {
          categoryBusy = false;
          $("#category-reload").disabled = false;
        }
      }

      function openCategoryForm(category = null) {
        categoryEditing = category;
        const form = $("#category-form");
        form.reset();
        $("#category-form-title").textContent = category ? "Edit category" : "Add category";
        $("#category-form-panel").hidden = false;
        $("#category-form-message").textContent = "";
        form.elements.name.value = category?.name || "";
        form.elements.slug.value = category?.slug || "";
        form.elements.sort_order.value = String(category?.sort_order ?? 0);
        form.elements.active.checked = category?.active ?? true;
        form.elements.name.focus();
      }

      async function submitCategoryForm(event) {
        event.preventDefault();
        if (categorySaving || categoryBusy) return;
        categorySaving = true;
        const form = event.currentTarget;
        const values = {
          name: form.elements.name.value,
          slug: form.elements.slug.value,
          sort_order: form.elements.sort_order.value,
          active: form.elements.active.checked,
        };
        $("#category-save").disabled = true;
        $("#category-form-message").textContent = "";
        try {
          const saved = await saveCategory(supabase, values, activeRole, categoryEditing);
          const wasEditing = Boolean(categoryEditing);
          categoryEditing = null;
          $("#category-form-panel").hidden = true;
          await loadCategoryView(true);
          await loadCatalogue(true);
          if (categoryData) setManagedMessage(`${saved.name} ${wasEditing ? "updated" : "added"} successfully.`, "success");
        } catch (error) {
          $("#category-form-message").textContent = formatContentError(error, "save");
        } finally {
          categorySaving = false;
          $("#category-save").disabled = false;
        }
      }

      function mediaCategoryName(product) {
        if (!product?.category_id) return "Uncategorised";
        return mediaData?.categories.find((category) => category.id === product.category_id)?.name || "Inactive or unavailable category";
      }

      function renderMediaProductOptions() {
        const select = $("#media-product");
        select.replaceChildren();
        const eligible = mediaData.products.filter((product) => product.status !== "archived");
        select.append(makeElement("option", "", eligible.length ? "Select a product" : "No available products"));
        select.options[0].value = "";
        eligible.forEach((product) => {
          const category = mediaCategoryName(product);
          const option = makeElement("option", "", `${product.title} · ${product.legacy_code} · ${category}`);
          option.value = product.id;
          select.append(option);
        });
        select.disabled = eligible.length === 0;
      }

      async function renderMediaRows() {
        if (!mediaData) return;
        const grid = $("#media-grid");
        grid.replaceChildren();
        const query = $("#media-search").value.trim().toLocaleLowerCase();
        const state = $("#media-status-filter").value;
        const products = new Map(mediaData.products.map((product) => [product.id, product]));
        const filtered = mediaData.images.filter((image) => {
          const product = products.get(image.product_id);
          const category = mediaCategoryName(product);
          const haystack = `${product?.title || ""} ${product?.legacy_code || ""} ${category} ${image.alt_text || ""} ${image.caption || ""}`.toLocaleLowerCase();
          return (!query || haystack.includes(query)) &&
            (state === "all" || (state === "public" ? image.bucket_id === "catalogue-public" : image.bucket_id === "catalogue-staging"));
        });
        $("#media-loading").hidden = true;
        $("#media-error").hidden = true;
        $("#media-empty").hidden = filtered.length !== 0;
        if (filtered.length === 0) {
          $("#media-empty").textContent = mediaData.images.length
            ? "No images match these filters."
            : "No product images yet. Upload an image to start its staging and approval workflow.";
          return;
        }
        const cards = await Promise.all(filtered.map(async (image) => {
          const product = products.get(image.product_id);
          const card = makeElement("article", "media-card");
          const preview = makeElement("img", "media-card-image");
          preview.alt = image.alt_text || `${product?.title || "Product"} image preview`;
          preview.loading = "lazy";
          try {
            preview.src = await imagePreviewUrl(supabase, image);
          } catch (error) {
            preview.alt = `Preview unavailable: ${error.message || "storage access denied"}`;
            preview.classList.add("media-preview-error");
          }
          card.append(preview);

          const body = makeElement("div", "media-card-body");
          const header = makeElement("div", "media-card-heading");
          const title = makeElement("div");
          title.append(makeElement("strong", "", product?.title || "Unavailable product"));
          title.append(makeElement("small", "", `${product?.legacy_code || "—"} · ${mediaCategoryName(product)}`));
          const status = makeElement("span", `catalogue-status ${image.bucket_id === "catalogue-public" ? "" : "status-draft"}`,
            image.bucket_id === "catalogue-public" ? "Approved public" : "Staging / hidden");
          header.append(title, status);
          body.append(header);

          const fields = makeElement("div", "media-card-fields");
          const altLabel = makeElement("label", "", "Alternative text");
          const altInput = makeElement("input", "media-alt");
          altInput.maxLength = 500;
          altInput.value = image.alt_text || "";
          altInput.dataset.imageAlt = image.id;
          altLabel.append(altInput);
          const captionLabel = makeElement("label", "", "Caption");
          const captionInput = makeElement("input", "media-caption");
          captionInput.maxLength = 500;
          captionInput.value = image.caption || "";
          captionInput.dataset.imageCaption = image.id;
          captionLabel.append(captionInput);
          const orderLabel = makeElement("label", "", "Display order");
          const orderInput = makeElement("input", "media-order");
          orderInput.type = "number";
          orderInput.min = "0";
          orderInput.step = "1";
          orderInput.value = String(image.sort_order);
          orderInput.dataset.imageOrder = image.id;
          orderLabel.append(orderInput);
          fields.append(altLabel, captionLabel, orderLabel);
          body.append(fields);

          if ((activeRole === "owner" || activeRole === "admin") && product) {
            const visibility = makeElement("div", "media-visibility");
            for (const [field, labelText] of [["homepage_visible", "Homepage"], ["lookbook_visible", "Lookbook"]]) {
              const label = makeElement("label");
              const checkbox = makeElement("input");
              checkbox.type = "checkbox";
              checkbox.checked = Boolean(product[field]);
              checkbox.disabled = product.status !== "published";
              checkbox.dataset.productVisibility = field;
              checkbox.dataset.productId = product.id;
              label.append(checkbox, document.createTextNode(`${labelText} visibility`));
              visibility.append(label);
            }
            body.append(visibility);
          }

          const actions = makeElement("div", "media-card-actions");
          const save = makeElement("button", "catalogue-button", "Save details");
          save.type = "button";
          save.dataset.imageAction = "save";
          save.dataset.imageId = image.id;
          actions.append(save);
          const replace = makeElement("button", "catalogue-button", "Replace");
          replace.type = "button";
          replace.dataset.imageAction = "replace";
          replace.dataset.imageId = image.id;
          if (image.bucket_id === "catalogue-public" && (activeRole === "owner" || activeRole === "admin")) actions.append(replace);
          if (image.bucket_id === "catalogue-staging" && (activeRole === "owner" || activeRole === "admin")) {
            const approve = makeElement("button", "catalogue-button catalogue-primary", "Approve / restore");
            approve.type = "button";
            approve.dataset.imageAction = "approve";
            approve.dataset.imageId = image.id;
            actions.append(approve);
          } else if (image.bucket_id === "catalogue-public" && (activeRole === "owner" || activeRole === "admin")) {
            const hide = makeElement("button", "catalogue-button catalogue-danger", "Hide");
            hide.type = "button";
            hide.dataset.imageAction = "hide";
            hide.dataset.imageId = image.id;
            actions.append(hide);
          }
          body.append(actions);
          card.append(body);
          return card;
        }));
        grid.append(...cards);
      }

      async function loadMediaView(force = false) {
        if (mediaBusy) return;
        if (mediaData && !force) {
          renderMediaProductOptions();
          await renderMediaRows();
          return;
        }
        mediaBusy = true;
        $("#media-loading").hidden = false;
        $("#media-error").hidden = true;
        $("#media-empty").hidden = true;
        $("#media-grid").replaceChildren();
        $("#media-reload").disabled = true;
        setManagedMessage("", "error", "#media-message");
        try {
          mediaData = await loadImageManagementData(supabase);
          renderMediaProductOptions();
          await renderMediaRows();
        } catch (error) {
          mediaData = null;
          $("#media-loading").hidden = true;
          $("#media-error").hidden = false;
          $("#media-error").textContent = formatContentError(error, "load");
          setManagedMessage(formatContentError(error, "load"), "error", "#media-message");
        } finally {
          mediaBusy = false;
          $("#media-reload").disabled = false;
        }
      }

      async function submitMediaUpload(event, replacement = null) {
        event.preventDefault();
        if (mediaSaving || mediaBusy) return;
        const form = $("#media-upload-form");
        const file = replacement ? event.currentTarget.files[0] : form.elements.file.files[0];
        if (!file) return;
        mediaSaving = true;
        const button = $("#media-upload");
        button.disabled = true;
        $("#media-upload-message").textContent = "";
        try {
          const values = {
            product_id: replacement?.product_id || form.elements.product_id.value,
            file,
            alt_text: replacement ? replacement.alt_text || "" : form.elements.alt_text.value,
            caption: replacement ? replacement.caption || "" : form.elements.caption.value,
            sort_order: replacement ? replacement.sort_order : form.elements.sort_order.value,
          };
          if (replacement) {
            await replaceProductImage(supabase, replacement, values, activeRole);
          } else {
            await uploadStagingImage(supabase, values, activeRole);
          }
          if (!replacement) {
            form.reset();
            $("#media-upload-preview").hidden = true;
            if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
            mediaPreviewUrl = null;
          }
          await loadMediaView(true);
          setManagedMessage(replacement
            ? "Replacement uploaded to staging. Approve it before it appears publicly."
            : "Image uploaded to staging for approval.", "success", "#media-message");
        } catch (error) {
          $("#media-upload-message").textContent = error.message || "Image upload failed.";
        } finally {
          replacingImage = null;
          $("#media-replace-file").value = "";
          mediaSaving = false;
          button.disabled = false;
        }
      }

      async function runMediaAction(image, action, button) {
        if (mediaSaving) return;
        const product = mediaData.products.find((item) => item.id === image.product_id);
        mediaSaving = true;
        try {
          if (action === "approve") {
            if (!window.confirm("Approve this image and promote it to public storage?")) return;
            button.disabled = true;
            const result = await approveProductImage(supabase, image, activeRole, activeUserId);
            await loadMediaView(true);
            setManagedMessage(result.warning || "Image approved and visible to public pages when its product is published and enabled.", result.warning ? "error" : "success", "#media-message");
          } else if (action === "hide") {
            if (!window.confirm("Hide this image from public pages? Its file will be retained in staging so it can be restored.")) return;
            button.disabled = true;
            await hideProductImage(supabase, image, activeRole);
            await loadMediaView(true);
            setManagedMessage("Image hidden from public display. The staged file can be restored by approving it again.", "success", "#media-message");
          } else if (action === "save") {
            const card = button.closest(".media-card");
            await updateProductImage(supabase, image, {
              alt_text: $(`[data-image-alt="${image.id}"]`, card).value,
              caption: $(`[data-image-caption="${image.id}"]`, card).value,
              sort_order: $(`[data-image-order="${image.id}"]`, card).value,
            }, activeRole);
            await loadMediaView(true);
            setManagedMessage("Image details and order saved.", "success", "#media-message");
          } else if (action === "replace") {
            replacingImage = image;
            $("#media-replace-file").click();
          }
          if (product && action !== "replace") return;
        } catch (error) {
          setManagedMessage(error.message || "Image action failed.", "error", "#media-message");
        } finally {
          button.disabled = false;
          mediaSaving = false;
        }
      }

      async function changeProductVisibility(checkbox) {
        if (mediaSaving) {
          checkbox.checked = !checkbox.checked;
          return;
        }
        const product = mediaData.products.find((item) => item.id === checkbox.dataset.productId);
        if (!product) {
          setManagedMessage("Product is no longer available. Reload the image list.", "error", "#media-message");
          return;
        }
        mediaSaving = true;
        checkbox.disabled = true;
        try {
          const updated = await setProductPublicVisibility(
            supabase, product, checkbox.dataset.productVisibility, checkbox.checked, activeRole,
          );
          Object.assign(product, updated);
          await loadMediaView(true);
          setManagedMessage("Public display setting updated.", "success", "#media-message");
        } catch (error) {
          checkbox.checked = !checkbox.checked;
          setManagedMessage(error.message || "Could not update public display settings.", "error", "#media-message");
        } finally {
          checkbox.disabled = false;
          mediaSaving = false;
        }
      }

  function fieldControl(parent, key, value, options = {}) {
    const label = makeElement("label", "editor-field");
    label.append(makeElement("span", "", options.label || CONTENT_FIELD_LABELS[key] || key));
    const control = makeElement(options.multiline ? "textarea" : "input", "editor-input");
    if (!options.multiline) {
      control.type = options.type || "text";
      if (options.type === "number") control.step = "0.1";
    } else {
      control.rows = options.rows || 3;
    }
    control.value = value ?? "";
    if (options.contentField) control.dataset.contentField = key;
    if (options.objectField) {
      control.dataset.objectIndex = String(options.objectIndex);
      control.dataset.objectField = key;
    }
    if (options.listField) control.dataset.listField = key;
    if (options.help) label.append(makeElement("small", "field-help", options.help));
    label.append(control);
    parent.append(label);
    return control;
  }

  function renderStructuredFields(parent, section, content) {
    if (section.structured === "steps" || section.structured === "tags") {
      const values = Array.isArray(content[section.structured]) ? content[section.structured] : [];
      fieldControl(parent, section.structured, values.join("\n"), {
        label: section.structured === "steps" ? "Four process steps (one per line)" : "Atelier tags (one per line)",
        multiline: true,
        rows: section.structured === "steps" ? 4 : 3,
        listField: true,
      });
      return;
    }
    const items = section.structured === "scenes"
      ? (Array.isArray(content.scenes) ? content.scenes : [])
      : (Array.isArray(content.items) ? content.items : []);
    const count = section.structured === "scenes" || section.structured === "items" ? 4 : items.length;
    const objectKeys = section.structured === "scenes"
      ? ["src", "caption", "label", "title", "sourcePage", "seconds"]
      : ["question", "answer"];
    const objectLabels = {
      src: "Scene video URL",
      caption: "Scene caption",
      label: "Scene label",
      title: "Scene title",
      sourcePage: "Pexels attribution URL",
      seconds: "Scene duration in seconds",
      question: "Question",
      answer: "Answer",
    };
    for (let index = 0; index < count; index += 1) {
      const item = items[index] || {};
      const group = makeElement("fieldset", "editor-object-group");
      group.append(makeElement(
        "legend",
        "",
        section.structured === "scenes" ? `Film scene ${index + 1}` : `FAQ ${index + 1}`,
      ));
      objectKeys.forEach((key) => fieldControl(group, key, item[key], {
        label: objectLabels[key],
        multiline: key === "answer" || key === "caption",
        rows: 2,
        type: key === "seconds" ? "number" : "text",
        objectField: true,
        objectIndex: index,
      }));
      parent.append(group);
    }
  }

  function renderHomepageSections() {
    const container = $("#homepage-section-list");
    container.replaceChildren();
    const rowsByKey = new Map((homepageData?.sections || []).map((row) => [row.section_key, row]));
    const orderedDefinitions = HOMEPAGE_SECTIONS.map((definition, index) => ({
      definition,
      index,
      row: rowsByKey.get(definition.key),
    })).sort((a, b) => (a.row?.sort_order ?? a.index) - (b.row?.sort_order ?? b.index));
    orderedDefinitions.forEach(({ definition, index, row }) => {
      if (!row) return;
      const button = makeElement(
        "button",
        `studio-section-button${definition.key === selectedHomepageSection ? " selected" : ""}`,
        definition.label,
      );
      button.type = "button";
      button.dataset.homepageSectionSelect = definition.key;
      button.append(makeElement("span", "", row.is_visible ? "Visible" : "Hidden"));
      button.setAttribute("aria-pressed", String(definition.key === selectedHomepageSection));
      button.dataset.sectionOrder = String(Number.isInteger(row.sort_order) ? row.sort_order : index);
      container.append(button);
    });
    renderSelectedHomepageSection();
  }

  function selectedHomepageRow() {
    return homepageData?.sections.find((section) => section.section_key === selectedHomepageSection) || null;
  }

  function homepageImageManagerEnabled() {
    return Boolean(homepageData && homepageData.release.status === "draft" &&
      isHomepageManager(activeRole) && homepageImageField);
  }

  function safePreviewSource(value) {
    if (typeof value !== "string" || !value) return null;
    try {
      const url = new URL(value, window.location.href);
      if (!["http:", "https:", "file:"].includes(url.protocol) || url.username || url.password) return null;
      const allowedOrigins = new Set([window.location.origin, new URL(config.url).origin]);
      if (!allowedOrigins.has(url.origin)) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function showHomepageImageManager(sectionKey, field, currentSrc, altText = "") {
    const supported = {
      hero: ["image_path"],
      atelier: ["image_path"],
      "craft-film": ["poster_path"],
    };
    if (!supported[sectionKey]?.includes(field)) return;
    selectedHomepageSection = sectionKey;
    editingHomepageSection = false;
    homepageImageField = { sectionKey, field };
    const definition = HOMEPAGE_SECTIONS.find((item) => item.key === sectionKey);
    $("#homepage-image-manager-title").textContent =
      `${definition.label}${field === "poster_path" ? " video poster" : " image"}`;
    const image = $("#homepage-image-current");
    const safeSource = safePreviewSource(currentSrc);
    image.hidden = !safeSource;
    if (safeSource) {
      image.src = safeSource;
      image.alt = altText || `${definition.label} image`;
    } else {
      image.removeAttribute("src");
    }
    $("#homepage-image-gallery").hidden = true;
    $("#homepage-image-upload-panel").hidden = true;
    $("#homepage-image-message").textContent = "";
    $("#homepage-image-manager").hidden = false;
    renderHomepageSections();
  }

  function renderHomepageImageGallery(group = "website") {
    const grid = $("#homepage-image-gallery-grid");
    grid.replaceChildren();
    HOMEPAGE_IMAGE_LIBRARY.filter((asset) => asset.group === group).forEach((asset) => {
      const card = makeElement("button", "homepage-image-choice");
      card.type = "button";
      card.dataset.homepageImagePath = asset.path;
      const image = makeElement("img");
      image.src = new URL(`../${asset.path}`, window.location.href).href;
      image.alt = asset.description;
      image.loading = "lazy";
      card.append(image);
      card.append(makeElement("strong", "", asset.path.split("/").pop()));
      card.append(makeElement("small", "", asset.description));
      grid.append(card);
    });
  }

  async function loadHomepageDraftImagePreviewUrls() {
    homepageImagePreviewUrls = new Map();
    const paths = [...new Set((homepageData?.sections || []).flatMap((section) => {
      const content = section.content || {};
      return [
        section.section_key === "hero" ? content.image_path : "",
        section.section_key === "atelier" ? content.image_path : "",
        section.section_key === "craft-film" ? content.poster_path : "",
      ].filter((path) => typeof path === "string" && path.startsWith("products/"));
    }))];
    if (!paths.length) return;
    const { data, error } = await supabase.from("product_images")
      .select("id,bucket_id,storage_path,alt_text,approved_at")
      .in("storage_path", paths);
    if (error) throw error;
    for (const image of data || []) {
      if (image.bucket_id !== "catalogue-staging") continue;
      homepageImagePreviewUrls.set(image.storage_path, await imagePreviewUrl(supabase, image));
    }
  }

  function homepageImageProductId() {
    const products = homepageData?.products || [];
    return products.find((product) => product.status === "published")?.id || products[0]?.id || "";
  }

  async function addHomepageImage(file, target = homepageImageField) {
    if (homepageImageBusy || !homepageData || homepageData.release.status !== "draft" ||
      !isHomepageManager(activeRole) || !target) return;
    const productId = homepageImageProductId();
    if (!productId) {
      $("#homepage-image-message").textContent = "Add a product in Catalogue before choosing a homepage image.";
      return;
    }
    try {
      const extension = validateImageFile(file);
      if (!["jpg", "png", "webp"].includes(extension)) {
        throw new Error("Choose a JPEG, PNG or WebP image.");
      }
    } catch (error) {
      $("#homepage-image-message").textContent = error.message;
      return;
    }
    homepageImageBusy = true;
    $("#homepage-image-message").textContent = "Adding image to private staging…";
    $("#homepage-image-manager").querySelectorAll("button,input").forEach((control) => { control.disabled = true; });
    try {
      const row = homepageData.sections.find((section) => section.section_key === target.sectionKey);
      if (!row) throw new Error("Select a homepage section before adding an image.");
      const uploaded = await uploadStagingImage(supabase, {
        product_id: productId,
        file,
        alt_text: row.content.image_alt || "",
        caption: null,
        sort_order: 0,
      }, activeRole);
      const previewUrl = await imagePreviewUrl(supabase, uploaded);
      homepageImagePreviewUrls.set(uploaded.storage_path, previewUrl);
      const updated = {
        ...row,
        content: { ...row.content, [target.field]: uploaded.storage_path },
      };
      homepageData.sections = homepageData.sections.map((section) =>
        section.section_key === updated.section_key ? updated : section);
      if (homepageImageField?.sectionKey === target.sectionKey &&
        homepageImageField?.field === target.field) {
        $("#homepage-image-current").src = previewUrl;
        $("#homepage-image-current").alt = row.content.image_alt ||
          `${HOMEPAGE_SECTIONS.find((item) => item.key === row.section_key).label} image`;
        $("#homepage-image-current").hidden = false;
        $("#homepage-image-gallery").hidden = true;
        $("#homepage-image-upload-panel").hidden = true;
      }
      $("#homepage-image-file").value = "";
      if (homepageImageUploadPreviewUrl) URL.revokeObjectURL(homepageImageUploadPreviewUrl);
      homepageImageUploadPreviewUrl = null;
      $("#homepage-image-upload-preview").hidden = true;
      markHomepageDirty();
      renderHomepageSections();
      sendHomepagePreview();
      const status = "Image added to your private draft preview. Save draft to keep it; approve it in Image approvals before publishing.";
      if (homepageImageField?.sectionKey === target.sectionKey) $("#homepage-image-message").textContent = status;
      else setEditorMessage(status, "success");
    } catch (error) {
      $("#homepage-image-message").textContent =
        error.message || "Could not add this image. Check your connection and try again.";
    } finally {
      homepageImageBusy = false;
      $("#homepage-image-manager").querySelectorAll("button,input").forEach((control) => {
        control.disabled = !homepageImageManagerEnabled();
      });
      $("#homepage-image-upload-confirm").disabled =
        !homepageImageManagerEnabled() || !$("#homepage-image-file").files[0];
    }
  }

  async function useHomepageGalleryAsset(path) {
    const asset = HOMEPAGE_IMAGE_LIBRARY.find((item) => item.path === path);
    if (!asset) {
      $("#homepage-image-message").textContent = "That image is not in the approved website image library.";
      return;
    }
    const target = homepageImageField && { ...homepageImageField };
    if (!target) return;
    try {
      const source = new URL(`../${asset.path}`, window.location.href);
      if (source.origin !== window.location.origin) {
        throw new Error("The selected image is not available from this website.");
      }
      const response = await fetch(source.href, { credentials: "same-origin", redirect: "error" });
      if (!response.ok) throw new Error(`Could not load the selected image (${response.status}).`);
      const blob = await response.blob();
      const typeByExtension = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
      const extension = asset.path.split(".").pop().toLowerCase();
      const file = new File([blob], asset.path.split("/").pop(), {
        type: typeByExtension[extension] || blob.type,
      });
      await addHomepageImage(file, target);
    } catch (error) {
      $("#homepage-image-message").textContent = error.message || "Could not load the selected image.";
    }
  }

  function renderSelectedHomepageSection() {
    const row = selectedHomepageRow();
    const definition = HOMEPAGE_SECTIONS.find((item) => item.key === selectedHomepageSection);
    $("#homepage-product-selection").hidden = selectedHomepageSection !== "collection";
    $("#homepage-section-edit").hidden = editingHomepageSection;
    $("#homepage-section-editor").hidden = !editingHomepageSection;
    $("#homepage-section-edit").disabled = !row || homepageBusy || homepageData?.release.status !== "draft";
    $("#homepage-section-visibility").disabled = !row || homepageBusy || homepageData?.release.status !== "draft";
    if (!row || !definition) {
      $("#homepage-selected-section").textContent = "Choose a section";
      $("#homepage-section-summary").textContent = "Select a section in the preview or from the section list to make changes.";
      $("#homepage-section-fields").replaceChildren();
      return;
    }

    $("#homepage-selected-section").textContent = definition.label;
    $("#homepage-section-summary").textContent = row.is_visible
      ? "This section is currently shown on the homepage."
      : "This section is hidden from the homepage. Its content is kept in your draft.";
    $("#homepage-section-visibility").textContent = row.is_visible ? "Hide section" : "Show section";
    $("#homepage-section-visibility").setAttribute("aria-pressed", String(row.is_visible));
    $("#homepage-section-fields").replaceChildren();
    if (!editingHomepageSection) return;

    const content = { ...emptySectionContent(definition.key), ...(row.content || {}) };
    const fields = makeElement("div", "editor-fields");
    definition.fields.filter((key) => !["image_path", "poster_path"].includes(key))
      .forEach((key) => fieldControl(fields, key, content[key], {
        multiline: ["body", "supporting_body", "heading"].includes(key),
        rows: ["body", "heading"].includes(key) ? 4 : 3,
        contentField: true,
        help: key === "heading"
          ? "Use a new line for a line break and *text* for emphasis."
          : null,
      }));
    renderStructuredFields(fields, definition, content);
    $("#homepage-section-fields").append(fields);
  }

  function collectSelectedSection() {
    const row = selectedHomepageRow();
    const definition = HOMEPAGE_SECTIONS.find((item) => item.key === selectedHomepageSection);
    if (!row || !definition) throw new Error("Select a homepage section before editing.");
    const content = { ...row.content };
    const fields = $("#homepage-section-fields");
    fields.querySelectorAll("[data-content-field]").forEach((input) => {
      content[input.dataset.contentField] = input.value;
    });
    const list = fields.querySelector("[data-list-field]");
    if (list) content[list.dataset.listField] = list.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (definition.structured === "scenes" || definition.structured === "items") {
      content[definition.structured] = Array.from({ length: 4 }, (_, objectIndex) => {
        const item = {};
        fields.querySelectorAll(`[data-object-index="${objectIndex}"]`).forEach((input) => {
          const value = input.value;
          item[input.dataset.objectField] = input.dataset.objectField === "seconds" && value !== ""
            ? Number(value)
            : value;
        });
        return item;
      });
    }
    return { ...row, content };
  }

  function sendHomepagePreview(selectedSectionKey = selectedHomepageSection, refreshCatalogue = false) {
    const frame = $("#homepage-live-preview");
    if (!frame?.contentWindow || !homepageData) return;
    frame.contentWindow.postMessage({
      type: "cfp:studio-homepage-draft",
      sections: homepageData.sections,
      productIds: collectProductIds(),
      products: homepageData.products || [],
      imagePreviewUrls: Object.fromEntries(homepageImagePreviewUrls),
      selectedSectionKey,
      refreshCatalogue,
      previewRevision: ++homepagePreviewRevision,
    }, previewMessageTargetOrigin(window.location));
  }

  function renderHomepageProducts() {
    const container = $("#homepage-product-list");
    container.replaceChildren();
    const selected = new Map((homepageData?.selectedProducts || []).map((item) => [item.product_id, item.sort_order]));
    const products = [...(homepageData?.products || [])].sort((a, b) => {
      const orderA = selected.has(a.id) ? selected.get(a.id) : Number.MAX_SAFE_INTEGER;
      const orderB = selected.has(b.id) ? selected.get(b.id) : Number.MAX_SAFE_INTEGER;
      return orderA - orderB || (a.homepage_sort_order || 0) - (b.homepage_sort_order || 0);
    });
    if (!products.length) {
      container.append(makeElement("p", "muted", "No designs are available to add yet. Add or publish designs in Catalogue first."));
    }
    products.forEach((product) => {
      const eligible = product.status === "published" && product.homepage_visible === true;
      const label = makeElement("label", "product-option");
      const checkbox = makeElement("input");
      checkbox.type = "checkbox";
      checkbox.value = product.id;
      checkbox.checked = selected.has(product.id);
      checkbox.dataset.productId = product.id;
      checkbox.dataset.eligible = String(eligible);
      const details = makeElement("span", "product-option-copy");
      details.append(makeElement("strong", "", product.title || product.legacy_code));
      const state = eligible
        ? "Ready for the homepage"
        : product.status === "archived"
          ? "Archived"
          : product.status === "draft"
            ? "Draft"
            : "Hidden from the homepage";
      details.append(makeElement("small", "", `${product.legacy_code} · ${state}`));
      label.append(checkbox, details);
      container.append(label);
    });
    updateProductCount();
    sendHomepagePreview();
  }

  function updateProductCount() {
    const count = $("#homepage-product-list").querySelectorAll("input[type=checkbox]:checked").length;
    $("#homepage-product-count").textContent = `${count} OF 8 SELECTED`;
    $("#homepage-product-count").classList.toggle("count-invalid", count !== 8);
  }

  function setEditorMessage(text, kind = "error") {
    const output = $("#homepage-editor-message");
    output.textContent = text || "";
    output.className = `editor-message ${text ? `is-${kind}` : ""}`;
  }

  function setHomepageBusy(busy) {
    homepageBusy = busy;
    const editingLocked = busy || !homepageData || homepageData.release.status !== "draft";
    $("#homepage-editor-view").querySelectorAll(
      ".section-fields input, .section-fields textarea, .section-fields select, .homepage-product-list input, " +
      ".studio-section-button, #homepage-section-save, #homepage-section-cancel, #homepage-image-manager button, " +
      "#homepage-image-manager input",
    ).forEach((control) => { control.disabled = editingLocked; });
    $("#homepage-image-upload-confirm").disabled =
      editingLocked || !$("#homepage-image-file").files[0];
    $("#homepage-section-edit").disabled = editingLocked || !selectedHomepageRow();
    $("#homepage-section-visibility").disabled = editingLocked || !selectedHomepageRow();
    $("#homepage-save").disabled = busy || homepageConflict || !homepageData || !homepageDirty || homepageData.release.status !== "draft";
    $("#homepage-preview").disabled = busy || !homepageData;
    $("#homepage-publish").disabled = busy || homepageConflict || !homepageData || homepageData.release.status !== "draft";
    $("#homepage-reload").disabled = busy;
    $("#homepage-draft-note").textContent = busy
      ? "Working with the secure homepage service…"
      : homepageConflict
        ? "This draft has changed on the server. Reload the latest version before saving or publishing."
        : homepageData?.release.status === "draft"
        ? "Save changes to this private draft, preview it, then publish when it is ready."
        : homepageData?.release.status === "published"
          ? "This release is published. Open Homepage Editor again to start the next draft."
          : "The active draft could not be loaded.";
  }

  function setVersionStatus() {
    const release = homepageData?.release;
    if (!release) {
      $("#homepage-release-status").textContent = "DRAFT UNAVAILABLE";
      $("#homepage-release-version").textContent = "";
      return;
    }
    $("#homepage-release-status").textContent = release.status === "published" ? "PUBLISHED" : "ACTIVE DRAFT";
    $("#homepage-release-version").textContent = `Version ${release.lock_version}`;
  }

  function validateAndCollectSections() {
    if (editingHomepageSection) {
      const current = collectSelectedSection();
      homepageData.sections = homepageData.sections.map((row) =>
        row.section_key === current.section_key ? current : row);
    }
    const sections = [...(homepageData?.sections || [])].sort((a, b) => a.sort_order - b.sort_order);
    const errors = validateHomepageDraftStructure(sections);
    if (errors.length) throw new Error(errors.join("\n"));
    return sections;
  }

  function collectProductIds() {
    const checkboxes = [...$("#homepage-product-list").querySelectorAll("input[type=checkbox]:checked")];
    return checkboxes.map((checkbox) => checkbox.dataset.productId);
  }

  function collectPublishErrors(sections, productIds) {
    return collectHomepagePublishErrors(sections, productIds, homepageData?.products || []);
  }

  function markHomepageDirty() {
    if (!homepageData || homepageData.release.status !== "draft" || homepageBusy) return;
    homepageDirty = true;
    $("#homepage-release-status").textContent = "UNSAVED CHANGES";
    $("#homepage-release-version").textContent = `Version ${homepageData.release.lock_version}`;
    setHomepageBusy(false);
  }

  async function loadHomepageEditor(force = false) {
    if (!isHomepageManager(activeRole)) {
      setEditorMessage("Homepage editing is available only to active Owner and Admin accounts.");
      return;
    }
    if (!force && homepageData?.release.status === "draft") {
      if (!homepageData.sections.some((section) => section.section_key === selectedHomepageSection)) {
        selectedHomepageSection = HOMEPAGE_SECTIONS[0].key;
      }
      renderHomepageSections();
      renderHomepageProducts();
      $("#overview-view").hidden = true;
      $("#homepage-editor-view").hidden = false;
      setVersionStatus();
      setHomepageBusy(false);
      return;
    }
    homepageData = null;
    homepageDirty = false;
    homepageConflict = false;
    editingHomepageSection = false;
    homepageImageField = null;
    homepageImagePreviewUrls = new Map();
    $("#homepage-image-manager").hidden = true;
    $("#overview-view").hidden = true;
    $("#homepage-editor-view").hidden = false;
    $("#homepage-section-list").replaceChildren(makeElement("p", "muted", "Loading the active homepage draft…"));
    $("#homepage-product-list").replaceChildren();
    $("#homepage-release-status").textContent = "LOADING DRAFT";
    $("#homepage-release-version").textContent = "";
    $("#homepage-reload").hidden = true;
    setEditorMessage("");
    setHomepageBusy(true);
    try {
      homepageData = await loadHomepageEditorData(supabase);
      await loadHomepageDraftImagePreviewUrls();
      homepageDirty = false;
      homepageConflict = false;
      if (!homepageData.sections.some((section) => section.section_key === selectedHomepageSection)) {
        selectedHomepageSection = HOMEPAGE_SECTIONS[0].key;
      }
      renderHomepageSections();
      renderHomepageProducts();
      setVersionStatus();
      $("#homepage-reload").hidden = true;
      setEditorMessage("Draft loaded. The public homepage has not been changed.", "success");
    } catch (error) {
      homepageData = null;
      setVersionStatus();
      $("#homepage-section-list").replaceChildren();
      setEditorMessage(formatHomepageError(error, "load"));
      $("#homepage-reload").hidden = false;
      $("#homepage-draft-note").textContent = "The draft could not be loaded. Retry after confirming the approved migration is installed.";
    } finally {
      setHomepageBusy(false);
    }
  }

  function showHomepageView() {
    $("#view-title").textContent = labels.homepage;
    $("#overview-view").hidden = true;
    $("#homepage-editor-view").hidden = false;
    if (homepageData?.release.status !== "draft") void loadHomepageEditor();
    else {
      setVersionStatus();
      setHomepageBusy(false);
    }
  }

  async function saveDraft() {
    if (!isHomepageManager(activeRole) || homepageBusy || !homepageData) return;
    let sections;
    let productIds;
    try {
      sections = validateAndCollectSections();
      productIds = collectProductIds();
    } catch (error) {
      setEditorMessage(error.message);
      return;
    }
    setEditorMessage("");
    setHomepageBusy(true);
    try {
      const version = await saveHomepageDraft(supabase, homepageData.release, sections, productIds);
      if (!Number.isInteger(version)) throw new Error("The save_homepage_draft RPC did not return a version number.");
      homepageData.release.lock_version = version;
      homepageData.sections = sections;
      homepageData.selectedProducts = productIds.map((product_id, sort_order) => ({ product_id, sort_order }));
      homepageDirty = false;
      homepageConflict = false;
      renderHomepageProducts();
      setVersionStatus();
      setEditorMessage("Draft saved. The published homepage is unchanged.", "success");
      $("#homepage-reload").hidden = true;
    } catch (error) {
      setEditorMessage(formatHomepageError(error, "save"));
      if (error?.code === "40001") {
        homepageConflict = true;
        $("#homepage-reload").hidden = false;
      }
    } finally {
      setHomepageBusy(false);
    }
  }

  function previewDraft() {
    if (!isHomepageManager(activeRole) || !homepageData) return;
    try {
      validateAndCollectSections();
      sendHomepagePreview(selectedHomepageSection, true);
      setEditorMessage("Refreshing your website preview…", "success");
    } catch (error) {
      setEditorMessage(error.message);
    }
  }

  async function publishDraft() {
    if (!isHomepageManager(activeRole) || homepageBusy || !homepageData) return;
    try {
      const sections = validateAndCollectSections();
      const productIds = collectProductIds();
      const errors = collectPublishErrors(sections, productIds);
      if (errors.length) {
        setEditorMessage(errors.join("\n"));
        return;
      }
    } catch (error) {
      setEditorMessage(error.message);
      return;
    }
    if (homepageDirty) {
      const shouldSave = window.confirm("Your edits have not been saved. Save this draft before publishing?");
      if (!shouldSave) return;
      await saveDraft();
      if (homepageDirty) return;
    }
    if (!window.confirm("Publish this homepage draft? It will replace the currently published homepage release.")) return;
    setEditorMessage("");
    setHomepageBusy(true);
    try {
      const version = await publishHomepageDraft(supabase, homepageData.release);
      if (!Number.isInteger(version)) throw new Error("The publish_homepage_release RPC did not return a version number.");
      homepageData.release.lock_version = version;
      homepageData.release.status = "published";
      homepageConflict = false;
      setVersionStatus();
      setEditorMessage("Homepage published successfully.", "success");
    } catch (error) {
      setEditorMessage(formatHomepageError(error, "publish"));
      if (error?.code === "40001") {
        homepageConflict = true;
        $("#homepage-reload").hidden = false;
      }
    } finally {
      setHomepageBusy(false);
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (!configured || !window.supabase?.createClient) {
      showScreen("setup-screen");
      return;
    }
    supabase = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    $("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector("button[type=submit]");
      button.disabled = true; button.textContent = "Signing in…"; message("");
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: $("#email").value.trim(), password: $("#password").value
        });
        if (error) throw error;
        const role = await resolveMembership(data.user);
        showDashboard(data.user, role);
      } catch (error) {
        message(error.message || "Sign-in failed. Please try again.");
      } finally {
        button.disabled = false; button.textContent = "Sign in securely";
      }
    });
    $("#sign-out").addEventListener("click", async () => {
      const { error } = await supabase.auth.signOut();
      if (error) { message(error.message, "#workspace-message"); return; }
      showLogin();
    });
    $("#side-nav").addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (!button) return;
      if (button.dataset.view === "homepage" && !isHomepageManager(activeRole)) {
        setEditorMessage("Homepage editing is available only to active Owner and Admin accounts.");
        return;
      }
      if (button.dataset.view !== "homepage") {
        homepageImageField = null;
        $("#homepage-image-manager").hidden = true;
      }
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
      $("#homepage-editor-view").hidden = button.dataset.view !== "homepage";
      $("#catalogue-view").hidden = button.dataset.view !== "catalogue";
      $("#lookbook-view").hidden = button.dataset.view !== "lookbook";
      $("#categories-view").hidden = button.dataset.view !== "categories";
      $("#media-view").hidden = button.dataset.view !== "media";
      $("#overview-view").hidden = ["homepage", "catalogue", "lookbook", "categories", "media"].includes(button.dataset.view);
      $("#view-title").textContent = labels[button.dataset.view] || "Overview";
      if (button.dataset.view === "homepage") showHomepageView();
      else if (button.dataset.view === "catalogue") void loadCatalogue();
      else if (button.dataset.view === "lookbook") void loadLookbookView();
      else if (button.dataset.view === "categories") void loadCategoryView();
      else if (button.dataset.view === "media") void loadMediaView();
      else if (button.dataset.view === "overview") message("", "#workspace-message");
      else message("This section will be enabled in the next implementation increment.", "#workspace-message");
    });
    $("#catalogue-add").addEventListener("click", () => openCatalogueForm());
    $("#catalogue-cancel").addEventListener("click", closeCatalogueForm);
    $("#catalogue-reload").addEventListener("click", () => { void loadCatalogue(true); });
    $("#lookbook-reload").addEventListener("click", () => { void loadLookbookView(true); });
    $("#lookbook-search").addEventListener("input", () => { void renderLookbookRows(); });
    $("#lookbook-status-filter").addEventListener("change", () => { void renderLookbookRows(); });
    $("#lookbook-products").addEventListener("change", (event) => {
      if (event.target.matches("[data-lookbook-product-id]")) void changeLookbookVisibility(event.target);
    });
    $("#catalogue-form").addEventListener("submit", (event) => { void submitCatalogueForm(event); });
    $("#catalogue-search").addEventListener("input", renderCatalogueRows);
    $("#catalogue-status-filter").addEventListener("change", renderCatalogueRows);
    $("#catalogue-category-filter").addEventListener("change", renderCatalogueRows);
    $("#catalogue-form").elements.title.addEventListener("input", (event) => {
      const slug = $("#catalogue-form").elements.slug;
      if (!catalogueProduct && (slug.dataset.autogenerated === "true" || !slug.value)) {
        slug.value = slugFromTitle(event.target.value);
        slug.dataset.autogenerated = "true";
      }
    });
    $("#catalogue-form").elements.slug.addEventListener("input", (event) => {
      event.target.dataset.autogenerated = "false";
    });
    $("#catalogue-rows").addEventListener("click", (event) => {
      const button = event.target.closest("[data-catalogue-action]");
      if (!button || !catalogueData) return;
      const product = catalogueData.products.find((item) => item.id === button.dataset.productId);
      if (!product) {
        setCatalogueMessage("That product is no longer in the loaded catalogue. Reload and try again.");
        return;
      }
      if (button.dataset.catalogueAction === "edit") openCatalogueForm(product);
      else void runCatalogueAction(product, button.dataset.catalogueAction);
    });
    $("#category-add").addEventListener("click", () => openCategoryForm());
    $("#category-cancel").addEventListener("click", () => {
      $("#category-form-panel").hidden = true;
      categoryEditing = null;
    });
    $("#category-reload").addEventListener("click", () => { void loadCategoryView(true); });
    $("#category-form").addEventListener("submit", (event) => { void submitCategoryForm(event); });
    $("#category-search").addEventListener("input", renderCategoryRows);
    $("#category-status-filter").addEventListener("change", renderCategoryRows);
    $("#category-form").elements.name.addEventListener("input", (event) => {
      const slug = $("#category-form").elements.slug;
      if (!categoryEditing && (slug.dataset.autogenerated === "true" || !slug.value)) {
        slug.value = slugFromTitle(event.target.value);
        slug.dataset.autogenerated = "true";
      }
    });
    $("#category-form").elements.slug.addEventListener("input", (event) => {
      event.target.dataset.autogenerated = "false";
    });
    $("#category-rows").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-category-action]");
      if (!button || !categoryData) return;
      const category = categoryData.find((item) => item.id === button.dataset.categoryId);
      if (!category) {
        setManagedMessage("That category is no longer available. Reload and try again.");
        return;
      }
      if (button.dataset.categoryAction === "edit") {
        openCategoryForm(category);
        return;
      }
      const activate = button.dataset.categoryAction === "restore";
      const prompt = activate
        ? `Restore “${category.name}” to public category navigation?`
        : `Deactivate “${category.name}”? It will no longer appear in public category navigation.`;
      if (!window.confirm(prompt)) return;
      button.disabled = true;
      try {
        await setCategoryActive(supabase, category, activeRole, activate);
        await loadCategoryView(true);
        await loadCatalogue(true);
        setManagedMessage(`${category.name} ${activate ? "restored" : "deactivated"}.`, "success");
      } catch (error) {
        setManagedMessage(error.message || "Could not update this category.");
      } finally {
        button.disabled = false;
      }
    });
    $("#media-upload-form").addEventListener("submit", (event) => { void submitMediaUpload(event); });
    $("#media-file").addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
      mediaPreviewUrl = null;
      if (!file) {
        $("#media-upload-preview").hidden = true;
        return;
      }
      try {
        mediaPreviewUrl = URL.createObjectURL(file);
        $("#media-preview-image").src = mediaPreviewUrl;
        $("#media-upload-preview").hidden = false;
        $("#media-upload-message").textContent = "";
      } catch (error) {
        $("#media-upload-preview").hidden = true;
        $("#media-upload-message").textContent = error.message || "Could not preview this file.";
      }
    });
    $("#media-replace-file").addEventListener("change", (event) => {
      if (replacingImage && event.currentTarget.files[0]) {
        void submitMediaUpload(event, replacingImage);
      }
    });
    $("#media-reload").addEventListener("click", () => { void loadMediaView(true); });
    $("#media-search").addEventListener("input", () => { void renderMediaRows(); });
    $("#media-status-filter").addEventListener("change", () => { void renderMediaRows(); });
    $("#media-grid").addEventListener("click", (event) => {
      const button = event.target.closest("[data-image-action]");
      if (!button || !mediaData) return;
      const image = mediaData.images.find((item) => item.id === button.dataset.imageId);
      if (image) void runMediaAction(image, button.dataset.imageAction, button);
    });
    $("#media-grid").addEventListener("change", (event) => {
      if (event.target.matches("[data-product-visibility]")) void changeProductVisibility(event.target);
    });
    $("#homepage-editor-view").addEventListener("input", (event) => {
      if (event.target.matches("[data-content-field], [data-list-field], [data-object-field]")) markHomepageDirty();
    });
    $("#homepage-editor-view").addEventListener("change", (event) => {
      if (event.target.matches("[data-product-id]")) {
        if (event.target.checked && event.target.dataset.eligible !== "true") {
          event.target.checked = false;
          setEditorMessage("Only published, homepage-visible products can be selected.");
          return;
        }
        updateProductCount();
        markHomepageDirty();
        sendHomepagePreview();
      }
    });
    $("#homepage-section-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-homepage-section-select]");
      if (!button || !homepageData) return;
      if (editingHomepageSection && !window.confirm("Discard the section edits that have not been applied?")) return;
      selectedHomepageSection = button.dataset.homepageSectionSelect;
      editingHomepageSection = false;
      homepageImageField = null;
      $("#homepage-image-manager").hidden = true;
      renderHomepageSections();
      sendHomepagePreview();
    });
    $("#homepage-live-preview").addEventListener("load", () => sendHomepagePreview());
    window.addEventListener("message", (event) => {
      if (!isTrustedPreviewMessage(
        event,
        $("#homepage-live-preview").contentWindow,
        window.location,
      )) return;
      if (["cfp:studio-homepage-preview-ready", "cfp:studio-homepage-preview-error"].includes(event.data?.type) &&
        event.data.previewRevision === homepagePreviewRevision) {
        if (event.data.type === "cfp:studio-homepage-preview-ready") {
          setEditorMessage("Your current draft is shown in the website preview. The published homepage is unchanged.", "success");
        } else {
          setEditorMessage("The draft preview could not refresh. Check your connection and try Preview draft again.");
        }
        return;
      }
      if (event.data?.type !== "cfp:homepage-section-selected" ||
        !HOMEPAGE_SECTIONS.some((section) => section.key === event.data.sectionKey)) return;
      if (editingHomepageSection && !window.confirm("Discard the section edits that have not been applied?")) return;
      selectedHomepageSection = event.data.sectionKey;
      editingHomepageSection = false;
      renderHomepageSections();
      if (typeof event.data.imageField === "string" &&
        typeof event.data.imageCurrentSrc === "string") {
        showHomepageImageManager(
          event.data.sectionKey,
          event.data.imageField,
          event.data.imageCurrentSrc,
          event.data.imageAlt,
        );
      } else {
        homepageImageField = null;
        $("#homepage-image-manager").hidden = true;
      }
      sendHomepagePreview();
    });
    $("#homepage-image-choose").addEventListener("click", () => {
      renderHomepageImageGallery("website");
      $("#homepage-image-gallery").hidden = false;
      $("#homepage-image-upload-panel").hidden = true;
    });
    $("#homepage-image-upload").addEventListener("click", () => {
      $("#homepage-image-gallery").hidden = true;
      $("#homepage-image-upload-panel").hidden = false;
      $("#homepage-image-file").click();
    });
    $("#homepage-image-gallery").addEventListener("click", (event) => {
      const tab = event.target.closest("[data-image-gallery-tab]");
      if (tab) {
        $("#homepage-image-gallery").querySelectorAll("[data-image-gallery-tab]").forEach((item) => {
          const selected = item === tab;
          item.classList.toggle("active", selected);
          item.setAttribute("aria-selected", String(selected));
        });
        renderHomepageImageGallery(tab.dataset.imageGalleryTab);
        return;
      }
      const choice = event.target.closest("[data-homepage-image-path]");
      if (choice) void useHomepageGalleryAsset(choice.dataset.homepageImagePath);
    });
    $("#homepage-image-file").addEventListener("change", (event) => {
      const file = event.currentTarget.files[0];
      if (homepageImageUploadPreviewUrl) URL.revokeObjectURL(homepageImageUploadPreviewUrl);
      homepageImageUploadPreviewUrl = null;
      $("#homepage-image-upload-preview").hidden = true;
      $("#homepage-image-upload-confirm").disabled = true;
      if (!file) return;
      try {
        const extension = validateImageFile(file);
        if (!["jpg", "png", "webp"].includes(extension)) {
          throw new Error("Choose a JPEG, PNG or WebP image.");
        }
        homepageImageUploadPreviewUrl = URL.createObjectURL(file);
        $("#homepage-image-upload-preview").src = homepageImageUploadPreviewUrl;
        $("#homepage-image-upload-preview").alt = file.name;
        $("#homepage-image-upload-preview").hidden = false;
        $("#homepage-image-upload-confirm").disabled = !homepageImageManagerEnabled();
        $("#homepage-image-message").textContent = "";
      } catch (error) {
        $("#homepage-image-message").textContent = error.message;
      }
    });
    $("#homepage-image-upload-confirm").addEventListener("click", () => {
      const file = $("#homepage-image-file").files[0];
      if (file) void addHomepageImage(file);
    });
    $("#homepage-image-upload-cancel").addEventListener("click", () => {
      $("#homepage-image-upload-panel").hidden = true;
      $("#homepage-image-file").value = "";
      $("#homepage-image-upload-preview").hidden = true;
      if (homepageImageUploadPreviewUrl) URL.revokeObjectURL(homepageImageUploadPreviewUrl);
      homepageImageUploadPreviewUrl = null;
    });
    $("#homepage-section-edit").addEventListener("click", () => {
      editingHomepageSection = true;
      renderSelectedHomepageSection();
    });
    $("#homepage-section-cancel").addEventListener("click", () => {
      editingHomepageSection = false;
      renderSelectedHomepageSection();
    });
    $("#homepage-section-save").addEventListener("click", () => {
      try {
        const updated = collectSelectedSection();
        homepageData.sections = homepageData.sections.map((row) =>
          row.section_key === updated.section_key ? updated : row);
        editingHomepageSection = false;
        markHomepageDirty();
        renderHomepageSections();
        sendHomepagePreview();
        const label = HOMEPAGE_SECTIONS.find((section) => section.key === updated.section_key).label;
        setEditorMessage(`${label} changes applied to your draft. Select Save draft to keep them.`, "success");
      } catch (error) {
        setEditorMessage(error.message);
      }
    });
    $("#homepage-section-visibility").addEventListener("click", () => {
      const row = selectedHomepageRow();
      if (!row) return;
      if (editingHomepageSection && !window.confirm("Discard the section edits that have not been applied?")) return;
      editingHomepageSection = false;
      homepageData.sections = homepageData.sections.map((section) => section.section_key === row.section_key
        ? { ...section, is_visible: !section.is_visible }
        : section);
      markHomepageDirty();
      renderHomepageSections();
      sendHomepagePreview();
      const label = HOMEPAGE_SECTIONS.find((section) => section.key === row.section_key).label;
      setEditorMessage(`${label} ${row.is_visible ? "hidden" : "shown"} in your draft. Select Save draft to keep the change.`, "success");
    });
    $("#homepage-save").addEventListener("click", () => { void saveDraft(); });
    $("#homepage-preview").addEventListener("click", previewDraft);
    $("#homepage-publish").addEventListener("click", () => { void publishDraft(); });
    $("#homepage-reload").addEventListener("click", () => {
      if (homepageDirty && !window.confirm("Reloading will discard the edits currently on screen. Continue?")) return;
      void loadHomepageEditor(true);
    });
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") showLogin();
    });
    try { await refreshSession(); }
    catch (error) { showLogin(); message(error.message); }
  });
})();

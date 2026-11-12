export const PRODUCT_FIELDS = [
  "id",
  "legacy_code",
  "slug",
  "title",
  "description",
  "record_type",
  "audience",
  "category_id",
  "status",
  "homepage_visible",
  "lookbook_visible",
  "pricing_public",
  "homepage_sort_order",
  "created_at",
  "updated_at",
].join(",");
const PRODUCT_IMAGE_FIELDS = "id,product_id,bucket_id,storage_path,alt_text,sort_order,approved_at";
const PAGE_SIZE = 500;

const STAFF_ROLES = new Set(["owner", "admin", "editor"]);
const MANAGER_ROLES = new Set(["owner", "admin"]);

function throwOnError(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function loadCatalogueData(client) {
  const [productRows, categories] = await Promise.all([
    loadAllPages(() => client.from("products").select(PRODUCT_FIELDS)
      .order("updated_at", { ascending: false }).order("id", { ascending: true })),
    client.from("categories").select("id,name,slug,sort_order,active").order("sort_order", { ascending: true }),
  ]);
  const productIds = productRows.map((product) => product.id);
  const imageGroups = await Promise.all(
    Array.from({ length: Math.ceil(productIds.length / 100) }, (_, index) =>
      loadAllPages(() => client.from("product_images").select(PRODUCT_IMAGE_FIELDS)
        .in("product_id", productIds.slice(index * 100, (index + 1) * 100))
        .order("sort_order", { ascending: true }).order("id", { ascending: true })),
    ),
  );
  return {
    products: productRows,
    categories: throwOnError(categories),
    images: imageGroups.flat(),
  };
}

async function loadAllPages(buildQuery) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    const page = throwOnError(result);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export function filterCatalogueProducts(products, search, status, categoryId) {
  const query = search.trim().toLocaleLowerCase();
  return products.filter((product) => {
    const matchesSearch = !query || [
      product.title,
      product.legacy_code,
      product.slug,
      product.description,
    ].some((value) => value?.toLocaleLowerCase().includes(query));
    return matchesSearch &&
      (status === "all" || product.status === status) &&
      (categoryId === "all" || (product.category_id || "") === categoryId);
  });
}

export function buildProductPayload(values, role, existingProduct = null) {
  if (!STAFF_ROLES.has(role)) throw new Error("An active studio role is required to manage catalogue products.");

  const payload = {
    title: values.title.trim(),
    description: values.description.trim() || null,
    audience: values.audience,
    category_id: values.category_id || null,
  };

  if (!existingProduct || MANAGER_ROLES.has(role)) {
    payload.legacy_code = values.legacy_code.trim();
    payload.slug = values.slug.trim();
    payload.record_type = values.record_type;
  }
  if (!existingProduct) {
    payload.status = MANAGER_ROLES.has(role) ? values.status : "draft";
  } else if (MANAGER_ROLES.has(role) && existingProduct.status !== "archived") {
    payload.status = values.status;
  }

  if (!existingProduct && MANAGER_ROLES.has(role)) {
    payload.homepage_visible = false;
    payload.lookbook_visible = false;
    payload.pricing_public = false;
  }
  return payload;
}

export async function saveCatalogueProduct(client, values, role, existingProduct = null) {
  const payload = buildProductPayload(values, role, existingProduct);
  if (existingProduct) {
    return throwOnError(await client.from("products")
      .update(payload)
      .eq("id", existingProduct.id)
      .select(PRODUCT_FIELDS)
      .single());
  }
  return throwOnError(await client.from("products")
    .insert(payload)
    .select(PRODUCT_FIELDS)
    .single());
}

export async function setCatalogueProductArchived(client, product, role, archived) {
  if (!MANAGER_ROLES.has(role)) {
    throw new Error("Only Owner and Admin roles can archive or restore catalogue products.");
  }
  const payload = archived
    ? {
      status: "archived",
      homepage_visible: false,
      lookbook_visible: false,
      pricing_public: false,
    }
    : {
      status: "draft",
      homepage_visible: false,
      lookbook_visible: false,
      pricing_public: false,
    };
  return throwOnError(await client.from("products")
    .update(payload)
    .eq("id", product.id)
    .select(PRODUCT_FIELDS)
    .single());
}

export function formatCatalogueError(error, operation) {
  if (error?.code === "42501") {
    return "Your studio role does not have permission to perform this catalogue action.";
  }
  if (error?.code === "23505") {
    return "That product code or slug is already in use. Choose a unique value and try again.";
  }
  if (error?.code === "23503") {
    return "The selected category or a related catalogue record is no longer available. Reload and try again.";
  }
  if (error?.code === "23514") {
    return error.message || "The product changes conflict with a catalogue rule.";
  }
  return error?.message || `Could not ${operation} the catalogue. Please try again.`;
}

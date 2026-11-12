export const CATEGORY_FIELDS = "id,name,slug,parent_id,sort_order,active,created_at,updated_at";
export const IMAGE_FIELDS = [
  "id",
  "product_id",
  "bucket_id",
  "storage_path",
  "alt_text",
  "caption",
  "sort_order",
  "is_primary",
  "approved_at",
  "approved_by",
  "width",
  "height",
  "created_at",
].join(",");

const STAFF_ROLES = new Set(["owner", "admin", "editor"]);
const MANAGER_ROLES = new Set(["owner", "admin"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

function throwOnError(result) {
  if (result.error) throw result.error;
  return result.data;
}

function requireStaff(role) {
  if (!STAFF_ROLES.has(role)) throw new Error("An active studio role is required for content management.");
}

function requireManager(role, action) {
  if (!MANAGER_ROLES.has(role)) throw new Error(`Only Owner and Admin roles can ${action}.`);
}

export function slugFromCategoryName(value) {
  return value.trim().toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function filterCategories(categories, search, status) {
  const query = search.trim().toLocaleLowerCase();
  return categories.filter((category) => {
    const matchesText = !query ||
      category.name.toLocaleLowerCase().includes(query) ||
      category.slug.toLocaleLowerCase().includes(query);
    return matchesText && (status === "all" || (status === "active") === category.active);
  });
}

export function buildCategoryPayload(values, role) {
  requireStaff(role);
  const name = values.name.trim();
  const slug = values.slug.trim();
  const sortOrder = Number(values.sort_order);
  if (!name) throw new Error("Enter a category name.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Use a lowercase slug with letters, numbers and single hyphens.");
  }
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    throw new Error("Category order must be a whole number greater than or equal to zero.");
  }
  return {
    name,
    slug,
    sort_order: sortOrder,
    active: Boolean(values.active),
  };
}

export async function loadCategories(client) {
  return throwOnError(await client.from("categories")
    .select(CATEGORY_FIELDS)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true }));
}

export async function saveCategory(client, values, role, existing = null) {
  const payload = buildCategoryPayload(values, role);
  const query = existing
    ? client.from("categories").update(payload).eq("id", existing.id)
    : client.from("categories").insert({ ...payload, parent_id: null });
  return throwOnError(await query.select(CATEGORY_FIELDS).single());
}

export async function setCategoryActive(client, category, role, active) {
  requireStaff(role);
  return throwOnError(await client.from("categories")
    .update({ active: Boolean(active) })
    .eq("id", category.id)
    .select(CATEGORY_FIELDS)
    .single());
}

export async function loadImageManagementData(client) {
  const [images, products, categories] = await Promise.all([
    client.from("product_images").select(IMAGE_FIELDS).order("sort_order", { ascending: true }),
    client.from("products")
      .select("id,legacy_code,title,category_id,status,homepage_visible,lookbook_visible")
      .order("title", { ascending: true }),
    client.from("categories")
      .select("id,name,slug,active,sort_order")
      .order("sort_order", { ascending: true }),
  ]);
  return {
    images: throwOnError(images),
    products: throwOnError(products),
    categories: throwOnError(categories),
  };
}

export function validateImageFile(file) {
  if (!file || !IMAGE_TYPES.has(file.type)) {
    throw new Error("Choose a JPEG, PNG, WebP or AVIF image.");
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("Images must be larger than zero and no larger than 10 MB.");
  }
  return IMAGE_TYPES.get(file.type);
}

function imageObjectPath(file, productId) {
  const extension = validateImageFile(file);
  return `products/${productId}/${crypto.randomUUID()}.${extension}`;
}

async function removeObject(client, bucket, path) {
  const result = await client.storage.from(bucket).remove([path]);
  if (result.error) throw result.error;
}

export async function uploadStagingImage(client, values, role) {
  requireStaff(role);
  const productId = values.product_id;
  if (!productId) throw new Error("Select a product for this image.");
  const sortOrder = Number(values.sort_order);
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    throw new Error("Image order must be a whole number greater than or equal to zero.");
  }
  const path = imageObjectPath(values.file, productId);
  const upload = await client.storage.from("catalogue-staging").upload(path, values.file, {
    contentType: values.file.type,
    upsert: false,
  });
  if (upload.error) throw upload.error;

  const inserted = await client.from("product_images").insert({
    product_id: productId,
    bucket_id: "catalogue-staging",
    storage_path: path,
    alt_text: String(values.alt_text || "").trim() || null,
    caption: String(values.caption || "").trim() || null,
    sort_order: sortOrder,
    is_primary: false,
    approved_at: null,
    approved_by: null,
  }).select(IMAGE_FIELDS).single();
  if (!inserted.error) return inserted.data;

  try {
    await removeObject(client, "catalogue-staging", path);
  } catch (cleanupError) {
    throw new Error(`${inserted.error.message} The uploaded staging file could not be cleaned up: ${cleanupError.message}`);
  }
  throw inserted.error;
}

export async function imagePreviewUrl(client, image) {
  if (image.bucket_id === "catalogue-public") {
    return client.storage.from("catalogue-public").getPublicUrl(image.storage_path).data.publicUrl;
  }
  const result = await client.storage.from("catalogue-staging")
    .createSignedUrl(image.storage_path, 300);
  return throwOnError(result).signedUrl;
}

export async function approveProductImage(client, image, role, actorId) {
  requireManager(role, "approve images");
  if (image.bucket_id !== "catalogue-staging" || image.approved_at) {
    throw new Error("Only an unapproved staging image can be approved.");
  }
  const downloaded = await client.storage.from("catalogue-staging").download(image.storage_path);
  const file = throwOnError(downloaded);
  const approvedAt = new Date().toISOString();
  const updated = await client.from("product_images").update({
    bucket_id: "catalogue-public",
    approved_at: approvedAt,
    approved_by: actorId,
  }).eq("id", image.id)
    .eq("bucket_id", "catalogue-staging")
    .is("approved_at", null)
    .select(IMAGE_FIELDS)
    .maybeSingle();
  if (updated.error) throw updated.error;
  const approvedImage = updated.data;
  if (!approvedImage || approvedImage.id !== image.id ||
    approvedImage.product_id !== image.product_id ||
    approvedImage.storage_path !== image.storage_path ||
    approvedImage.bucket_id !== "catalogue-public" ||
    !approvedImage.approved_at || approvedImage.approved_by !== actorId) {
    throw new Error("Image approval did not update the expected staging record. Reload the image and try again.");
  }

  try {
    const uploaded = await client.storage.from("catalogue-public").upload(image.storage_path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploaded.error) throw uploaded.error;
  } catch (uploadError) {
    try {
      await removeObject(client, "catalogue-public", image.storage_path);
    } catch (cleanupError) {
      return {
        image: approvedImage,
        warning: `Public image upload failed: ${uploadError.message}. The public object could not be removed: ${cleanupError.message}. The image record remains approved; verify the public object and retry cleanup before changing its approval.`,
      };
    }

    try {
      const reverted = await client.from("product_images").update({
        bucket_id: "catalogue-staging",
        approved_at: null,
        approved_by: null,
      }).eq("id", image.id)
        .eq("bucket_id", "catalogue-public")
        .eq("approved_at", approvedImage.approved_at)
        .eq("approved_by", actorId)
        .select(IMAGE_FIELDS)
        .maybeSingle();
      if (reverted.error) throw reverted.error;
      const stagingImage = reverted.data;
      if (!stagingImage || stagingImage.id !== image.id ||
        stagingImage.bucket_id !== "catalogue-staging" ||
        stagingImage.approved_at !== null || stagingImage.approved_by !== null) {
        throw new Error("The approval rollback did not update the expected image record.");
      }
    } catch (rollbackError) {
      throw new Error(`Public image upload failed: ${uploadError.message}. The public object was removed, but the approval record could not be reverted: ${rollbackError.message}. Verify the database record before retrying.`);
    }
    throw uploadError;
  }

  try {
    await removeObject(client, "catalogue-staging", image.storage_path);
  } catch (cleanupError) {
    return {
      image: approvedImage,
      warning: `The image is approved, but its staging copy could not be removed: ${cleanupError.message}`,
    };
  }
  return { image: approvedImage, warning: "" };
}

export async function hideProductImage(client, image, role) {
  requireManager(role, "hide public images");
  if (image.bucket_id !== "catalogue-public" || !image.approved_at) {
    throw new Error("Only an approved public image can be hidden.");
  }
  const downloaded = await client.storage.from("catalogue-public").download(image.storage_path);
  const file = throwOnError(downloaded);
  const stagingPath = imageObjectPath(file, image.product_id);
  const staged = await client.storage.from("catalogue-staging").upload(stagingPath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (staged.error) throw staged.error;

  try {
    await removeObject(client, "catalogue-public", image.storage_path);
  } catch (error) {
    try {
      await removeObject(client, "catalogue-staging", stagingPath);
    } catch (cleanupError) {
      throw new Error(`The public image could not be hidden: ${error.message}. The staging copy could not be cleaned up: ${cleanupError.message}`);
    }
    throw error;
  }

  const updated = await client.from("product_images").update({
    bucket_id: "catalogue-staging",
    storage_path: stagingPath,
    approved_at: null,
    approved_by: null,
  }).eq("id", image.id).select(IMAGE_FIELDS).single();
  if (updated.error) {
    const recoveryErrors = [];
    try {
      const restored = await client.storage.from("catalogue-public").upload(image.storage_path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (restored.error) throw restored.error;
    } catch (recoveryError) {
      recoveryErrors.push(`public image restore failed: ${recoveryError.message}`);
    }
    try {
      await removeObject(client, "catalogue-staging", stagingPath);
    } catch (cleanupError) {
      recoveryErrors.push(`staging copy cleanup failed: ${cleanupError.message}`);
    }
    if (recoveryErrors.length) {
      throw new Error(`${updated.error.message}; ${recoveryErrors.join("; ")}`);
    }
    throw updated.error;
  }
  return updated.data;
}

export async function updateProductImage(client, image, values, role) {
  requireStaff(role);
  const sortOrder = Number(values.sort_order);
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    throw new Error("Image order must be a whole number greater than or equal to zero.");
  }
  const payload = {
    alt_text: values.alt_text.trim() || null,
    caption: values.caption.trim() || null,
    sort_order: sortOrder,
  };
  return throwOnError(await client.from("product_images").update(payload)
    .eq("id", image.id).select(IMAGE_FIELDS).single());
}

export async function replaceProductImage(client, image, values, role) {
  requireStaff(role);
  if (image.bucket_id === "catalogue-public") {
    requireManager(role, "replace public images");
  }
  const replacement = await uploadStagingImage(client, {
    ...values,
    product_id: image.product_id,
    sort_order: image.sort_order,
  }, role);
  if (image.bucket_id === "catalogue-public") {
    try {
      await hideProductImage(client, image, role);
    } catch (error) {
      throw new Error(`Replacement uploaded as a staging image, but the current public image could not be hidden: ${error.message}`);
    }
  }
  return replacement;
}

export async function setProductPublicVisibility(client, product, field, visible, role) {
  requireManager(role, "change public product visibility");
  if (!["homepage_visible", "lookbook_visible"].includes(field)) {
    throw new Error("Choose a supported public destination.");
  }
  if (visible && product.status !== "published") {
    throw new Error("Publish the product before making it visible on the public website.");
  }
  return throwOnError(await client.from("products")
    .update({ [field]: Boolean(visible) })
    .eq("id", product.id)
    .select("id,legacy_code,title,category_id,status,homepage_visible,lookbook_visible")
    .single());
}

export function publicImageUrl(projectUrl, storagePath) {
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${projectUrl.replace(/\/+$/, "")}/storage/v1/object/public/catalogue-public/${encodedPath}`;
}

export function formatContentError(error, operation) {
  if (error?.code === "42501") {
    return "Your studio role does not have permission to perform this content action.";
  }
  if (error?.code === "23505") {
    return "That category slug is already in use. Choose a unique slug and try again.";
  }
  if (error?.code === "23503") {
    return "The selected product or category is no longer available. Reload and try again.";
  }
  if (error?.code === "23514") {
    return error.message || "The content change conflicts with a database rule.";
  }
  return error?.message || `Could not ${operation} this content. Please try again.`;
}

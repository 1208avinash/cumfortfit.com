import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const expectedHost = "dkcjzisqufqgjtrgstch.supabase.co";
const projectUrl = process.env.CFP_STAGING_URL || "";
const publishableKey = process.env.CFP_STAGING_PUBLISHABLE_KEY || "";
const credentials = {
  owner: [process.env.CFP_OWNER_EMAIL, process.env.CFP_OWNER_PASSWORD],
  admin: [process.env.CFP_ADMIN_EMAIL, process.env.CFP_ADMIN_PASSWORD],
  editor: [process.env.CFP_EDITOR_EMAIL, process.env.CFP_EDITOR_PASSWORD],
  ordinary: [process.env.CFP_ORDINARY_EMAIL, process.env.CFP_ORDINARY_PASSWORD],
};
const missing = !projectUrl || !publishableKey ||
  Object.values(credentials).some(([email, password]) => !email || !password);
const clients = {};
const runPrefix = `products/__rls-audit-${randomUUID()}`;
const created = new Set();
const payload = Buffer.from("RIFF\x1a\0\0\0WEBPVP8 \x0e\0\0\0\x00\x00\x00\x9d\x01\x2a\x01\0\x01\0\x00", "binary");
const updatedPayload = Buffer.from("RIFF\x1a\0\0\0WEBPVP8 \x0e\0\0\0\x01\x00\x00\x9d\x01\x2a\x01\0\x01\0\x00", "binary");
const denialMessage = /row.level security|permission denied|not authorized|access denied|unauthorized/i;

function assertStagingConfiguration() {
  const url = new URL(projectUrl);
  assert.equal(url.protocol, "https:", "Staging requests must use HTTPS.");
  assert.equal(url.hostname, expectedHost,
    "Refusing to send requests to a project other than the approved staging project.");
  assert.equal(url.port, "", "Unexpected custom port is not allowed.");
  assert.equal(url.pathname, "/", "The staging URL must be the project base URL.");
  assert.equal(url.search, "", "The staging URL must not include a query string.");
  assert.equal(url.hash, "", "The staging URL must not include a fragment.");
  assert.equal(url.username + url.password, "", "Credentials must not be embedded in the staging URL.");
  assert.ok(publishableKey.startsWith("sb_publishable_"),
    "Use the staging publishable key; service-role keys are not accepted.");
}

function assertTestPath(bucket, path) {
  assert.ok(["catalogue-public", "catalogue-staging"].includes(bucket),
    "Refusing an unexpected bucket.");
  assert.ok(path.startsWith(`${runPrefix}/`),
    "Refusing an object path outside this test run's unique prefix.");
}

async function request(path, { token, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${projectUrl}${path}`, {
    method,
    redirect: "error",
    headers: {
      apikey: publishableKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    bytes,
    text: bytes.toString("utf8"),
    contentType: response.headers.get("content-type") || "",
  };
}

function isAuthorizationDenial(result) {
  if ([401, 403].includes(result.status)) return true;
  if (result.status !== 400) return false;
  try {
    const body = JSON.parse(result.text);
    return denialMessage.test(String(body.message || body.error || body.error_description || ""));
  } catch {
    return false;
  }
}

function assertAuthorizationDenied(result, context) {
  assert.ok(isAuthorizationDenial(result),
    `${context}: expected an authorization denial, received HTTP ${result.status}.`);
}

function assertReadDeniedForKnownObject(result, context) {
  const concealedAsMissing = result.status === 404 ||
    (result.status === 400 && isMissingObject(result));
  assert.ok(isAuthorizationDenial(result) || concealedAsMissing,
    `${context}: expected an authorization denial for a verified existing object, received HTTP ${result.status}.`);
}

async function signIn(role) {
  const [email, password] = credentials[role];
  const result = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(result.status >= 200 && result.status < 300,
    `${role} staging sign-in failed (HTTP ${result.status}); response body withheld.`);
  const session = JSON.parse(result.text);
  assert.ok(session.access_token, `${role} sign-in returned no access token.`);
  return session.access_token;
}

async function upload(role, bucket, path) {
  assertTestPath(bucket, path);
  const result = await request(`/storage/v1/object/${bucket}/${path}`, {
    token: clients[role],
    method: "POST",
    headers: { "Content-Type": "image/webp", "x-upsert": "false" },
    body: payload,
  });
  if (result.status >= 200 && result.status < 300) created.add(`${bucket}/${path}`);
  return result;
}

async function removeAsOwner(bucket, path) {
  await removeAsRole("owner", bucket, path);
  const result = bucket === "catalogue-public"
    ? await request(`/storage/v1/object/public/${bucket}/${path}`)
    : await request(`/storage/v1/object/authenticated/${bucket}/${path}`,
      { token: clients.owner });
  assert.ok(isMissingObject(result),
    `Owner deletion did not remove test object ${bucket}/${path} (HTTP ${result.status}).`);
  created.delete(`${bucket}/${path}`);
}

async function removeAsRole(role, bucket, path) {
  assertTestPath(bucket, path);
  assert.ok(created.has(`${bucket}/${path}`),
    "Refusing to delete an object not created by this test run.");
  const result = await request(`/storage/v1/object/${bucket}`, {
    token: clients[role],
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [path] }),
  });
  assert.ok(result.status >= 200 && result.status < 300,
    `${role} could not delete test-only object ${bucket}/${path} (HTTP ${result.status}); response body withheld.`);
}

function isMissingObject(result) {
  if (result.status === 404) return true;
  if (result.status !== 400) return false;
  try {
    const body = JSON.parse(result.text);
    return /object (was )?not found|does not exist/i.test(
      String(body.message || body.error || body.error_description || ""),
    );
  } catch {
    return false;
  }
}

async function verifyPublicObject(bucket, path, expectedBytes) {
  const result = await request(`/storage/v1/object/public/${bucket}/${path}`);
  assert.equal(result.status, 200, `Public object read returned HTTP ${result.status}.`);
  assert.deepEqual(result.bytes, expectedBytes, "Public object content does not match expected bytes.");
}

before(async () => {
  if (missing) return;
  assertStagingConfiguration();
  for (const role of Object.keys(credentials)) clients[role] = await signIn(role);
});

after(async () => {
  if (!clients.owner) return;
  for (const object of [...created]) {
    const [bucket, ...parts] = object.split("/");
    await removeAsOwner(bucket, parts.join("/"));
  }
});

test("staging storage permission checks", { skip: missing && "Set staging URL, publishable key, and four role credentials." }, async (t) => {
  assertStagingConfiguration();

  await t.test("Editor can upload and read under catalogue-staging/products", async () => {
    const path = `${runPrefix}/editor.webp`;
    const result = await upload("editor", "catalogue-staging", path);
    assert.ok(result.status >= 200 && result.status < 300,
      `Editor upload denied with HTTP ${result.status}; response body withheld.`);
    const editorRead = await request(`/storage/v1/object/authenticated/catalogue-staging/${path}`,
      { token: clients.editor });
    assert.equal(editorRead.status, 200, `Editor staging read returned HTTP ${editorRead.status}.`);
    assert.deepEqual(editorRead.bytes, payload);
  });

  await t.test("Editor cannot upload into catalogue-public", async () => {
    const result = await upload("editor", "catalogue-public", `${runPrefix}/editor-public.webp`);
    assertAuthorizationDenied(result, "Editor public-bucket upload");
  });

  await t.test("Editor cannot update or delete an existing staging object", async () => {
    const path = `${runPrefix}/editor.webp`;
    const before = await request(`/storage/v1/object/authenticated/catalogue-staging/${path}`,
      { token: clients.editor });
    assert.equal(before.status, 200, "Precondition failed: staging object is missing or unreadable.");
    const update = await request(`/storage/v1/object/catalogue-staging/${path}`, {
      token: clients.editor,
      method: "PUT",
      headers: { "Content-Type": "image/webp", "x-upsert": "true" },
      body: updatedPayload,
    });
    assertAuthorizationDenied(update, "Editor staging update");
    const deletion = await request("/storage/v1/object/catalogue-staging", {
      token: clients.editor,
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [path] }),
    });
    assertAuthorizationDenied(deletion, "Editor staging delete");
    const afterRead = await request(`/storage/v1/object/authenticated/catalogue-staging/${path}`,
      { token: clients.editor });
    assert.equal(afterRead.status, 200, "Denied operations unexpectedly removed the staging object.");
    assert.deepEqual(afterRead.bytes, payload, "Denied update unexpectedly changed the staging object.");
  });

  await t.test("ordinary user and anonymous visitor cannot read an existing staging object", async () => {
    const path = `${runPrefix}/editor.webp`;
    const ownerRead = await request(`/storage/v1/object/authenticated/catalogue-staging/${path}`,
      { token: clients.owner });
    assert.equal(ownerRead.status, 200, "Precondition failed: staging object is missing.");
    const ordinaryRead = await request(`/storage/v1/object/authenticated/catalogue-staging/${path}`,
      { token: clients.ordinary });
    assertReadDeniedForKnownObject(ordinaryRead, "Ordinary staging read");
    const anonymousRead = await request(`/storage/v1/object/authenticated/catalogue-staging/${path}`);
    assertReadDeniedForKnownObject(anonymousRead, "Anonymous staging read");
    const controlRead = await request(`/storage/v1/object/authenticated/catalogue-staging/${path}`,
      { token: clients.editor });
    assert.equal(controlRead.status, 200, "Control check failed: staging object no longer exists.");
  });

  await t.test("ordinary user cannot upload to either bucket", async () => {
    for (const bucket of ["catalogue-staging", "catalogue-public"]) {
      const result = await upload("ordinary", bucket, `${runPrefix}/ordinary-${bucket}.webp`);
      assertAuthorizationDenied(result, `Ordinary upload to ${bucket}`);
    }
  });

  await t.test("Owner and Admin can upload, update, read and delete public test assets", async (t) => {
    for (const role of ["owner", "admin"]) {
      await t.test(role, async () => {
        const path = `${runPrefix}/${role}-public.webp`;
        const uploadResult = await upload(role, "catalogue-public", path);
        assert.ok(uploadResult.status >= 200 && uploadResult.status < 300,
          `${role} public upload denied with HTTP ${uploadResult.status}; response body withheld.`);
        await verifyPublicObject("catalogue-public", path, payload);

        const editorUpdate = await request(`/storage/v1/object/catalogue-public/${path}`, {
          token: clients.editor,
          method: "PUT",
          headers: { "Content-Type": "image/webp", "x-upsert": "true" },
          body: updatedPayload,
        });
        assertAuthorizationDenied(editorUpdate, "Editor public-object update");
        const editorDelete = await request("/storage/v1/object/catalogue-public", {
          token: clients.editor,
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes: [path] }),
        });
        assertAuthorizationDenied(editorDelete, "Editor public-object delete");
        await verifyPublicObject("catalogue-public", path, payload);

        const update = await request(`/storage/v1/object/catalogue-public/${path}`, {
          token: clients[role],
          method: "PUT",
          headers: { "Content-Type": "image/webp", "x-upsert": "true" },
          body: updatedPayload,
        });
        assert.ok(update.status >= 200 && update.status < 300,
          `${role} public update denied with HTTP ${update.status}; response body withheld.`);
        await verifyPublicObject("catalogue-public", path, updatedPayload);

        await removeAsRole(role, "catalogue-public", path);
        const afterDelete = await request(`/storage/v1/object/public/catalogue-public/${path}`);
        assert.ok(isMissingObject(afterDelete),
          `Deleted public object remains readable or returned an unexpected response (HTTP ${afterDelete.status}).`);
        created.delete(`catalogue-public/${path}`);
      });
    }
  });

  await t.test("Owner and Admin can delete staging test assets", async (t) => {
    for (const role of ["owner", "admin"]) {
      await t.test(role, async () => {
        const path = `${runPrefix}/${role}-staging.webp`;
        const uploadResult = await upload(role, "catalogue-staging", path);
        assert.ok(uploadResult.status >= 200 && uploadResult.status < 300,
          `${role} staging upload denied with HTTP ${uploadResult.status}; response body withheld.`);
        const beforeDelete = await request(`/storage/v1/object/authenticated/catalogue-staging/${path}`,
          { token: clients[role] });
        assert.equal(beforeDelete.status, 200,
          `${role} could not read its existing staging test object.`);
        assert.deepEqual(beforeDelete.bytes, payload);
        const deletion = await request("/storage/v1/object/catalogue-staging", {
          token: clients[role],
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes: [path] }),
        });
        assert.ok(deletion.status >= 200 && deletion.status < 300,
          `${role} staging delete denied with HTTP ${deletion.status}; response body withheld.`);
        const afterDelete = await request(`/storage/v1/object/authenticated/catalogue-staging/${path}`,
          { token: clients[role] });
        assert.ok(isMissingObject(afterDelete),
          `Deleted staging object remains readable or returned an unexpected response (HTTP ${afterDelete.status}).`);
        created.delete(`catalogue-staging/${path}`);
      });
    }
  });

  await t.test("cleanup remains confined to objects created by this test run", async () => {
    for (const object of [...created]) {
      const [bucket, ...parts] = object.split("/");
      await removeAsOwner(bucket, parts.join("/"));
    }
    assert.equal(created.size, 0, "One or more test objects remain after cleanup.");
  });
});

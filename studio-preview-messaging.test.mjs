import assert from "node:assert/strict";
import test from "node:test";
import {
  isTrustedPreviewMessage,
  previewMessageTargetOrigin,
} from "./studio-preview-messaging.mjs";

test("studio preview uses exact origins for web pages", () => {
  const location = { protocol: "https:", origin: "https://studio.example" };
  const source = {};

  assert.equal(previewMessageTargetOrigin(location), location.origin);
  assert.equal(isTrustedPreviewMessage({
    source,
    origin: location.origin,
  }, source, location), true);
  assert.equal(isTrustedPreviewMessage({
    source,
    origin: "https://untrusted.example",
  }, source, location), false);
  assert.equal(isTrustedPreviewMessage({
    source: {},
    origin: location.origin,
  }, source, location), false);
});

test("studio preview safely bridges opaque file origins with exact source checks", () => {
  const location = { protocol: "file:", origin: "file://" };
  const source = {};

  assert.equal(previewMessageTargetOrigin(location), "*");
  assert.equal(isTrustedPreviewMessage({
    source,
    origin: "null",
  }, source, location), true);
  assert.equal(isTrustedPreviewMessage({
    source: {},
    origin: "null",
  }, source, location), false);
  assert.equal(isTrustedPreviewMessage({
    source,
    origin: "https://untrusted.example",
  }, source, location), false);
});

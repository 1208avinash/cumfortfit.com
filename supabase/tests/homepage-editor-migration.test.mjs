import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(here, "..", "migrations", "008_homepage_releases.sql");
const incompleteDraftMigrationPath = join(here, "..", "migrations", "009_allow_incomplete_homepage_drafts.sql");
const migration = readFileSync(migrationPath, "utf8");
const incompleteDraftMigration = readFileSync(incompleteDraftMigrationPath, "utf8");

function getFunctionDefinition(qualifiedName) {
  const start = migration.indexOf(`create or replace function ${qualifiedName}(`);
  assert.notEqual(start, -1, `Missing function ${qualifiedName}`);
  const next = migration.indexOf("\ncreate or replace function ", start + 1);
  return migration.slice(start, next === -1 ? migration.length : next);
}

test("homepage migration defines versioned releases and the approved sections", () => {
  for (const table of [
    "homepage_releases",
    "homepage_section_revisions",
    "homepage_release_products",
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}\\b`, "i"));
  }
  for (const section of [
    "hero", "introduction", "craft-film", "collection",
    "process", "atelier", "cta", "faq",
  ]) {
    assert.ok(migration.includes(`'${section}'`), `Missing homepage section ${section}`);
  }
  assert.match(migration, /lock_version integer not null/i);
  assert.match(migration, /unique \(release_id, sort_order\)/i);
  assert.match(migration, /create unique index homepage_releases_single_draft_idx[\s\S]*?where status = 'draft'/i);
  assert.match(migration, /create unique index homepage_releases_single_published_idx[\s\S]*?where status = 'published'/i);
});

test("homepage writes use restricted RPCs and do not depend on migration 005 helpers", () => {
  for (const fn of [
    "create_homepage_draft",
    "save_homepage_draft",
    "publish_homepage_release",
  ]) {
    assert.match(migration, new RegExp(`function public\\.${fn}\\b`, "i"));
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${fn}\\(`, "i"),
    );
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${fn}\\(`, "i"),
    );
  }
  assert.doesNotMatch(migration, /private\.current_admin_role|private\.audit_row_change/i);
  assert.match(migration, /private\.is_homepage_manager\(\)/i);
  for (const fn of [
    "private.is_homepage_manager",
    "private.guard_editor_homepage_card_summary",
    "private.audit_homepage_change",
    "public.create_homepage_draft",
    "public.save_homepage_draft",
    "public.publish_homepage_release",
  ]) {
    const definition = getFunctionDefinition(fn);
    assert.match(definition, /security definer/i, `${fn} must remain SECURITY DEFINER`);
    assert.match(definition, /set search_path = pg_catalog/i, `${fn} must use a pinned safe search_path`);
  }
  assert.match(migration, /grant execute on function private\.is_homepage_manager\(\) to authenticated/i);
});

test("draft visibility, publication checks, and audit triggers are represented", () => {
  assert.match(migration, /status = 'published'/i);
  assert.match(migration, /is_visible/i);
  assert.doesNotMatch(
    migration,
    /grant select on public\.homepage_releases\s*,/i,
    "Release metadata must use the column-scoped grant, not table-level SELECT",
  );
  assert.match(migration, /grant select \(id, status, lock_version, published_at, created_at, updated_at\)/i);
  assert.match(migration, /All eight required homepage sections must be present/i);
  assert.match(migration, /Exactly eight published, homepage-visible products are required/i);
  assert.match(migration, /audit_homepage_releases/i);
  assert.match(migration, /audit_homepage_section_revisions/i);
  assert.match(migration, /audit_homepage_release_products/i);
  assert.match(migration, /guard_editor_homepage_card_summary_insert/i);
  assert.match(migration, /guard_editor_homepage_card_summary_update/i);
  assert.match(migration, /homepage_has_approved_public_image/i);
  assert.match(migration, /homepage_is_safe_cta_href/i);
  assert.match(migration, /homepage_is_safe_video_url/i);
  assert.match(migration, /homepage_video_scenes_are_valid/i);
  assert.match(migration, /the hero section must be visible/i);
  assert.equal(
    (migration.match(/p_expected_version is null or v_release\.lock_version <> p_expected_version/gi) ?? []).length,
    2,
    "Save and publish must reject a null expected lock version",
  );
});

test("migration 009 allows incomplete draft JSON while keeping strict validation on publication", () => {
  // The unnamed inline content CHECK in 008 gets PostgreSQL's table_column_check name.
  assert.match(migration, /content jsonb not null\s+check\s*\(private\.homepage_section_content_is_valid\(section_key, content\)\)/i);
  assert.match(incompleteDraftMigration, /homepage_section_revisions_content_check \(table_column_check\)/i);
  assert.match(incompleteDraftMigration, /drop constraint if exists homepage_section_revisions_content_check/i);
  assert.match(incompleteDraftMigration, /add constraint homepage_section_revisions_content_draft_safety_check\s+check\s*\(private\.homepage_section_draft_content_is_safe\(section_key, content\)\)/i);
  assert.match(incompleteDraftMigration, /create or replace function private\.homepage_section_draft_content_is_safe/i);
  assert.match(incompleteDraftMigration, /private\.homepage_is_safe_image_path/i);
  assert.match(incompleteDraftMigration, /private\.homepage_is_safe_cta_href/i);
  assert.match(incompleteDraftMigration, /private\.homepage_is_safe_video_url/i);
  assert.match(incompleteDraftMigration, /private\.homepage_is_safe_video_source_url/i);
  assert.match(incompleteDraftMigration, /if v_scene \? 'seconds' then\s+if jsonb_typeof\(v_scene -> 'seconds'\) not in \('number', 'string'\) then\s+return false;\s+end if;\s+if jsonb_typeof\(v_scene -> 'seconds'\) = 'string'\s+and btrim\(v_scene ->> 'seconds'\) <> '' then\s+return false;\s+end if;\s+end if;/i,
    "scene duration may be absent, blank text, or numeric, but not a nonblank string");
  assert.match(incompleteDraftMigration, /from public, anon, authenticated/i);
  assert.match(incompleteDraftMigration, /create trigger homepage_releases_validate_publish_content/i);
  assert.match(incompleteDraftMigration, /new\.status = 'published' and old\.status is distinct from new\.status/i);
  assert.match(incompleteDraftMigration, /private\.homepage_section_content_is_valid\(section_key, content\)/i);
  assert.match(incompleteDraftMigration, /All eight required homepage sections must be present/i);
  assert.match(incompleteDraftMigration, /revoke all on function private\.enforce_homepage_publish_content\(\)\s+from public, anon, authenticated/i);
  assert.doesNotMatch(incompleteDraftMigration, /insert\s+into|delete\s+from|update\s+public\.homepage_section_revisions/i);
});

test("incomplete Process drafts allow zero to four string steps and reject malformed or excess steps", () => {
  const processValidation = incompleteDraftMigration.match(
    /when 'process' then([\s\S]*?)when 'atelier' then/i,
  )?.[1];
  assert.ok(processValidation, "Process draft validation must be present");
  assert.match(processValidation, /if p_content \? 'steps' then/i);
  assert.match(processValidation, /jsonb_typeof\(p_content -> 'steps'\) is distinct from 'array'/i);
  assert.match(processValidation, /jsonb_array_length\(p_content -> 'steps'\) > 4/i);
  assert.match(processValidation, /jsonb_typeof\(s\.value\) is distinct from 'string'/i);

  for (const count of [0, 1, 3, 4]) {
    assert.ok(count <= 4, `${count} supplied steps should be allowed`);
  }
  assert.ok(5 > 4, "five supplied steps should be rejected by the upper-bound check");
  for (const malformedStep of [null, 42, {}, []]) {
    assert.notEqual(typeof malformedStep, "string", "non-string steps should be rejected");
  }
});

test("draft creation is idempotent and safe under concurrent requests", () => {
  const createDraft = getFunctionDefinition("public.create_homepage_draft");
  assert.match(createDraft, /pg_advisory_xact_lock\(434821,\s*1\)/i);
  assert.match(createDraft, /where status = 'draft'\s+for update/i);
  assert.match(createDraft, /on conflict \(status\) where status = 'draft' do nothing/i);
  assert.match(createDraft, /concurrent homepage draft creation could not be observed/i);
  assert.match(createDraft, /return v_release_id/i);
});

test("the SQL integration suite is transactional and explicitly simulates roles", () => {
  const sqlPath = join(here, "012_homepage_editor_permission_tests.sql");
  const sql = readFileSync(sqlPath, "utf8");
  assert.match(sql, /BEGIN;/i);
  assert.match(sql, /ROLLBACK;/i);
  assert.match(sql, /SET LOCAL ROLE anon/i);
  assert.match(sql, /SET LOCAL ROLE authenticated/i);
  assert.match(sql, /not an Auth-issued JWT/i);
  assert.match(sql, /initial_draft_count/i);
  assert.match(sql, /admin: repeated draft creation returns the existing draft unchanged/i);
  assert.match(sql, /database invariant: second draft row rejected/i);
  assert.match(sql, /duplicate product selection: rejected/i);
  assert.match(sql, /null version: save rejected/i);
  assert.match(sql, /null version: publish rejected/i);
  assert.match(sql, /unsafe image path: rejected on save/i);
  assert.match(sql, /unsafe CTA scheme: rejected on save/i);
  assert.match(sql, /unsafe video URL: rejected on save/i);
  assert.match(sql, /unsafe video scene URL: rejected on save/i);
  assert.match(sql, /unapproved public image: cannot publish/i);
  assert.match(sql, /hidden hero: cannot publish/i);
  assert.match(sql, /incomplete required text: draft save succeeds/i);
  assert.match(sql, /not \(content \? 'image_path'\)/i);
  assert.match(sql, /incomplete required text: publish rejected/i);
  assert.match(sql, /incomplete publish failure: prior published release remains current/i);
  assert.match(sql, /missing-section publish failure: prior release remains current/i);
});

test("the homepage data change preserves public card identifiers and LocalStorage key", () => {
  const homepagePath = join(here, "..", "..", "index.html");
  const homepage = readFileSync(homepagePath, "utf8");
  for (let number = 1; number <= 8; number += 1) {
    const code = `CF-${String(number).padStart(2, "0")}`;
    assert.equal(homepage.split(`data-id="${code}"`).length - 1, 1, `${code} must remain stable`);
  }
  assert.ok(homepage.includes("customFitPrime.savedDesigns.v1"));
});

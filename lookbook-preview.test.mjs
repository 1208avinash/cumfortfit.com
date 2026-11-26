import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

test('unified lookbook keeps artwork and detail boards in their approved collections', async () => {
  const html = await readFile(join(root, 'lookbook.html'), 'utf8');
  const preview = html.split('<section class="new-preview"')[1]?.split('<section class="section closing')[0];
  assert.ok(preview, 'additional collections exist');
  assert.doesNotMatch(preview, /class="[^"]*\b(?:design-card|save-btn)\b/);

  const groups = [...preview.matchAll(/<section class="preview-group" id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)];
  const expected = [
    ['mens-trousers', ['IMG-01', 'IMG-02', 'IMG-03', 'IMG-04', 'IMG-05', 'IMG-06', 'IMG-07', 'IMG-08']],
    ['womens-blouse-collection', ['IMG-10', 'IMG-09', 'IMG-11', 'IMG-12', 'IMG-13', 'IMG-14', 'IMG-15', 'IMG-16', 'IMG-17', 'IMG-18', 'IMG-27', 'IMG-29', 'IMG-30', 'IMG-32', 'IMG-34']],
    ['womens-salwar', ['IMG-19', 'IMG-20', 'IMG-21', 'IMG-22', 'IMG-23', 'IMG-24', 'IMG-25', 'IMG-26']],
    ['womens-kurta', ['IMG-28', 'IMG-31', 'IMG-33', 'IMG-35', 'IMG-36']],
  ];
  assert.equal(groups.length, expected.length);
  const paths = [];
  for (const [index, group] of groups.entries()) {
    const [id, ids] = expected[index];
    assert.equal(group[1], id);
    const images = [...group[2].matchAll(/<img src="(assets\/lookbook\/new-catalogue\/[^"]+\/(IMG-\d{2})\.webp)"[^>]*>/g)];
    assert.deepEqual(images.map(image => image[2]), ids);
    paths.push(...images.map(image => image[1]));
  }
  assert.equal(new Set(paths).size, 36);
  await Promise.all(paths.map(path => access(join(root, path))));
  const blouse = groups[1][2];
  assert.match(blouse, /class="collection-artwork"[\s\S]*?IMG-10\.webp[\s\S]*?class="preview-grid"/);
  const details = blouse.split('<div class="detail-collection">')[1];
  assert.ok(details, 'supporting details are separate from catalogue boards');
  assert.deepEqual([...details.matchAll(/src="[^"]+\/(IMG-\d{2})\.webp"/g)].map(match => match[1]), ['IMG-27', 'IMG-29', 'IMG-30', 'IMG-32', 'IMG-34']);
  const originalIds = [...html.matchAll(/<article class="design-card"[^>]*data-id="(LB-\d{2})"/g)].map(match => match[1]);
  assert.equal(originalIds.length, 22);
  assert.equal(new Set(originalIds).size, 22);
  const imageContainers = [...html.matchAll(/<div class="design-image">([\s\S]*?)<\/div>/g)];
  assert.equal(imageContainers.length, 22);
  assert.ok(imageContainers.every(match => !/<button|design-badge/.test(match[1])), 'controls do not cover original artwork');
  assert.equal([...html.matchAll(/<div class="design-actions">/g)].length, 22);
});

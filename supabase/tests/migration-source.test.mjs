import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");
const migrations = readdirSync(migrationsDir)
  .filter((name) => /^\d{3}_.*\.sql$/.test(name))
  .sort();
const dollarDelimiter = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

function findUnterminatedDollarQuotes(source) {
  const unterminated = [];
  let index = 0;

  while (index < source.length) {
    if (source.startsWith("--", index)) {
      const newline = source.indexOf("\n", index + 2);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }

    if (source.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (source.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      continue;
    }

    const char = source[index];
    if (char === "'" || char === '"') {
      const quote = char;
      const escapeString = quote === "'" &&
        index > 0 && /[eE]/.test(source[index - 1]) &&
        (index < 2 || !/[A-Za-z0-9_$]/.test(source[index - 2]));
      index += 1;
      while (index < source.length) {
        if (escapeString && source[index] === "\\") {
          index += 2;
        } else if (source[index] === quote && source[index + 1] === quote) {
          index += 2;
        } else if (source[index] === quote) {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }

    if (char === "$" && (index === 0 || !/[A-Za-z0-9_$]/.test(source[index - 1]))) {
      const match = source.slice(index).match(dollarDelimiter);
      if (match) {
        const delimiter = match[0];
        const closingIndex = source.indexOf(delimiter, index + delimiter.length);
        if (closingIndex === -1) {
          unterminated.push({ delimiter, offset: index });
          break;
        }
        index = closingIndex + delimiter.length;
        continue;
      }
      if (!source[index + 1] || !/[A-Za-z0-9_$]/.test(source[index + 1])) {
        unterminated.push({ delimiter: "$", offset: index });
        index += 1;
        continue;
      }
    }

    index += 1;
  }

  return unterminated;
}

test("migration files have terminated PostgreSQL dollar-quoted bodies", async (t) => {
  for (const migration of migrations) {
    await t.test(migration, () => {
      const source = readFileSync(join(migrationsDir, migration), "utf8");
      const unterminated = findUnterminatedDollarQuotes(source);
      assert.deepEqual(unterminated, [],
        `Unterminated dollar-quote body in ${migration}: ${JSON.stringify(unterminated)}`);
    });
  }
});

test("lexer ignores dollar-like text in comments and quoted values", () => {
  const source = [
    "-- $$ and $tag$ in a line comment",
    "/* $$ /* $nested$ */ $tag$ */",
    "SELECT '$$ $tag$' AS ordinary_string, E'escaped \\' $body$' AS escaped_string;",
    'SELECT "$identifier$" AS quoted_identifier;',
    "DO $body$ BEGIN PERFORM '$not_a_delimiter$'; END $body$;",
  ].join("\n");
  assert.deepEqual(findUnterminatedDollarQuotes(source), []);
});

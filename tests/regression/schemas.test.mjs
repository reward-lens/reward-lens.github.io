/**
 * Every generated file validates against its schema.
 *
 *   node --test tests/regression/schemas.test.mjs
 *
 * A component reading a field that is not in its schema is a build failure,
 * and the only way that stays true is if something checks. This is that check.
 *
 * WHY A HAND-WRITTEN VALIDATOR RATHER THAN ajv. ajv 8.20 resolves in this tree
 * today and it is a TRANSITIVE dependency: nothing in package.json asks for it,
 * so a dependency bump elsewhere can take it away and this file would start
 * skipping instead of failing. The validator below covers exactly the keywords
 * design/schemas/ uses, and it THROWS ON ANY KEYWORD IT DOES NOT IMPLEMENT.
 * That is the property that matters: it cannot quietly under-check. A gate that
 * passes because it did not understand the rule is the failure mode this whole
 * build is organised against.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const SCHEMAS = join(ROOT, "design/schemas");
const DATA = join(ROOT, "src/data");

/** schema basename -> the generated file it describes. */
const BINDINGS = {
  release: "release.json",
  "run-series": "run-series.json",
  catalogue: "catalogue.json",
  quantities: "quantities.json",
  refusals: "refusals.json",
  "open-targets": "open-targets.json",
  "banned-terms": "banned-terms.json",
  decomposition: "decomposition.json",
  "evidence-index": "evidence-index.json",
  "evidence-records": "evidence-records.json",
  ledger: "ledger.json",
  cards: "cards.json",
  intervention: "intervention.json",
  "grader-cards": "grader-cards.json",
  bundles: "bundles.json",
};

/**
 * Schemas whose file is deliberately ABSENT, with the reason.
 *
 * This is not a skip. The test below asserts the file is absent and names the
 * ruling, so the slot stays visible and flipping it back is one line. A schema
 * quietly dropped from BINDINGS is how a rejected figure comes back.
 *
 * Empty today. `decomposition` sat here between the withdrawal of its first
 * subject and DECISIONS.md D-37, which bound it to
 * campaign.result.TOPO-HODGE. The mechanism stays because the situation
 * recurs: a schema is ready and no subject has been ruled on.
 */
const PENDING = {};

/** Keywords the validator implements. Anything else is an error, not a pass. */
const KNOWN = new Set([
  "$schema", "$id", "$ref", "$defs", "title", "description",
  "type", "const", "enum", "required", "properties", "additionalProperties",
  "propertyNames", "minProperties", "items", "minItems", "maxItems",
  "minLength", "minimum", "maximum", "exclusiveMinimum", "pattern", "format",
]);

const typeOf = (v) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
};

const typeMatches = (want, actual) =>
  want === actual || (want === "number" && actual === "integer");

/**
 * Returns a list of human-readable violations. Empty means valid.
 * `root` carries $defs so a local $ref resolves.
 */
function validate(schema, value, path, root, seen = new Set()) {
  const out = [];
  for (const key of Object.keys(schema)) {
    if (!KNOWN.has(key)) {
      throw new Error(
        `tests/regression/schemas.test.mjs does not implement the JSON Schema keyword ` +
          `"${key}" (used at ${path}). Implement it rather than letting this file ` +
          `report a pass it did not earn.`,
      );
    }
  }

  if (schema.$ref) {
    const name = schema.$ref.replace("#/$defs/", "");
    const target = root.$defs?.[name];
    if (!target) return [`${path}: $ref ${schema.$ref} does not resolve`];
    if (seen.has(schema.$ref)) return out;
    return validate(target, value, path, root, new Set([...seen, schema.$ref]));
  }

  if (schema.type) {
    const wanted = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!wanted.some((w) => typeMatches(w, actual))) {
      return [`${path}: expected type ${wanted.join(" or ")}, got ${actual}`];
    }
  }
  if ("const" in schema && value !== schema.const) {
    out.push(`${path}: expected the constant ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    out.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      out.push(`${path}: string shorter than ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      out.push(`${path}: ${JSON.stringify(value)} does not match /${schema.pattern}/`);
    }
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      out.push(`${path}: ${JSON.stringify(value)} is not a date-time`);
    }
    if (schema.format === "uri" && !/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      out.push(`${path}: ${JSON.stringify(value)} is not a URI`);
    }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      out.push(`${path}: ${value} is below the minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      out.push(`${path}: ${value} is above the maximum ${schema.maximum}`);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      out.push(`${path}: ${value} must exceed ${schema.exclusiveMinimum}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      out.push(`${path}: ${value.length} items, minimum ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      out.push(`${path}: ${value.length} items, maximum ${schema.maxItems}`);
    }
    if (schema.items) {
      value.forEach((item, i) => out.push(...validate(schema.items, item, `${path}[${i}]`, root, seen)));
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      out.push(`${path}: ${keys.length} properties, minimum ${schema.minProperties}`);
    }
    for (const required of schema.required ?? []) {
      if (!(required in value)) out.push(`${path}: missing required property "${required}"`);
    }
    if (schema.propertyNames?.pattern) {
      const re = new RegExp(schema.propertyNames.pattern);
      for (const k of keys) {
        if (!re.test(k)) out.push(`${path}: key ${JSON.stringify(k)} does not match /${schema.propertyNames.pattern}/`);
      }
    }
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (sub) {
        out.push(...validate(sub, v, `${path}.${k}`, root, seen));
      } else if (schema.additionalProperties === false) {
        out.push(
          `${path}.${k}: not in the schema. A component reading this field is reading ` +
            `something nothing has agreed to keep.`,
        );
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        out.push(...validate(schema.additionalProperties, v, `${path}.${k}`, root, seen));
      }
    }
  }
  return out;
}

describe("every generated file validates against its schema", () => {
  test("every schema in design/schemas/ is bound to a file", () => {
    const onDisk = readdirSync(SCHEMAS)
      .filter((f) => f.endsWith(".schema.json"))
      .map((f) => f.replace(".schema.json", ""))
      .sort();
    assert.deepEqual(
      onDisk,
      Object.keys(BINDINGS).sort(),
      "a schema with no generated file, or a binding with no schema. Fifteen of each.",
    );
  });

  for (const [name, file] of Object.entries(BINDINGS)) {
    if (name in PENDING) {
      test(`${file} is deliberately absent`, () => {
        assert.ok(
          existsSync(join(SCHEMAS, `${name}.schema.json`)),
          `${name}.schema.json is missing. The schema stays; only the subject is unruled.`,
        );
        assert.equal(
          existsSync(join(DATA, file)),
          false,
          `src/data/${file} exists and it should not. ${PENDING[name]}`,
        );
      });
      continue;
    }
    test(`${file} against ${name}.schema.json`, () => {
      const schemaPath = join(SCHEMAS, `${name}.schema.json`);
      const dataPath = join(DATA, file);
      assert.ok(existsSync(schemaPath), `${schemaPath} is missing`);
      assert.ok(
        existsSync(dataPath),
        `src/data/${file} is missing. Run the generator that writes it; there is no fallback.`,
      );
      const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
      const data = JSON.parse(readFileSync(dataPath, "utf-8"));
      const problems = validate(schema, data, file.replace(".json", ""), schema);
      assert.deepEqual(problems, [], `${problems.length} violation(s):\n  ${problems.join("\n  ")}`);
    });
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const hub = read("../app/resources/page.tsx");
const article = read("../app/resources/[slug]/page.tsx");
const layout = read("../app/layout.tsx");
const css = read("../app/resources/editorial.module.css");

test("customer-facing resource copy omits internal production labels", () => {
  assert.doesNotMatch(`${hub}\n${article}`, /2,?000\+?\s*word|<strong>pillar:|>pillar</i);
});

test("hub and article metadata include canonical social images", () => {
  for (const source of [layout, hub, article]) {
    assert.match(source, /openGraph/);
    assert.match(source, /images/);
    assert.match(source, /twitter/);
  }
});

test("resources use Hackshop's dark orange system and a useful wide layout", () => {
  assert.match(css, /#0a0a0a/i);
  assert.match(css, /#ff7a00/i);
  assert.match(css, /min\(1280px/);
  assert.match(css, /@media\(max-width:640px\)/);
});

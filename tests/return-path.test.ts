import assert from "node:assert/strict";
import { test } from "node:test";
import { loginHref, safeReturnPath } from "../src/lib/return-path";

test("signing in returns to a page of the Hub", () => {
  assert.equal(safeReturnPath("/resources"), "/resources");
  assert.equal(safeReturnPath("/resources?member=abc&week=2026-10-12"), "/resources?member=abc&week=2026-10-12");
  assert.equal(safeReturnPath("/"), "/");
});

test("anything that isn't a page of the Hub goes Home", () => {
  for (const value of [null, undefined, 42, "", "resources", "https://evil.example/", "//evil.example/x", "/\\evil.example", "/api/auth/login", "/api", "/api?x=1", "/war\nSet-Cookie: x", "/" + "a".repeat(600)]) {
    assert.equal(safeReturnPath(value), "/", String(value).slice(0, 40));
  }
});

test("the sign-in link carries the page to come back to", () => {
  assert.equal(loginHref("/"), "/api/auth/login");
  assert.equal(loginHref("/resources?member=abc"), "/api/auth/login?next=%2Fresources%3Fmember%3Dabc");
  assert.equal(loginHref("//evil.example"), "/api/auth/login");
});

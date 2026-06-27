import assert from "node:assert/strict";
import test from "node:test";
import { arithmeticFlag } from "../lib/analysis/checks/arithmetic";

test("does not invent a subtotal from parsed lines", () => {
  const result = arithmeticFlag({
    total: 22.5,
    lineItems: [
      { description: "Fare", amount: 20.5 },
      { description: "Platform fee", amount: 1.2 },
      { description: "Driver fee", amount: 0.5 },
      { description: "Trip distance", amount: 21.45 },
    ],
  }, 95);

  assert.equal(result.status, "pending");
});

test("checks an explicitly printed subtotal, tax, and total", () => {
  const result = arithmeticFlag({
    subtotal: 20,
    tax: 1.8,
    total: 21.8,
  }, 95);

  assert.equal(result.status, "passed");
});

test("flags a mismatch in an explicitly printed amount block", () => {
  const result = arithmeticFlag({
    subtotal: 20,
    tax: 1.8,
    total: 25,
  }, 95);

  assert.equal(result.status, "triggered");
});

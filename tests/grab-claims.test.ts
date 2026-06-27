import assert from "node:assert/strict";
import test from "node:test";
import { grabClaimFlags } from "../lib/analysis/claims/grab";
import type { ExtractedFields } from "../lib/analysis/types";

function flag(fields: ExtractedFields, id: string) {
  const found = grabClaimFlags(fields).find((item) => item.id === id);
  assert.ok(found, `Expected flag ${id}`);
  return found;
}

test("transport receipts pass when every optional charge row reconciles", () => {
  const fields: ExtractedFields = {
    merchant: "Grab",
    total: 21.8,
    lineItems: [
      { description: "Fare", amount: 19.8 },
      { description: "Platform fee", amount: 1.2 },
      { description: "Ride Cover", amount: 0.3 },
      { description: "Driver fee", amount: 0.5 },
    ],
    grab: {
      receiptKind: "transport",
      bookingId: "A-123",
      serviceType: "JustGrab",
      pickup: "A",
      dropoff: "B",
      tripDateTime: "2026-06-24T10:00:00+08:00",
      receiptDateTime: "2026-06-24T10:30:00+08:00",
      lineItemsComplete: true,
    },
  };

  assert.equal(flag(fields, "grab-arithmetic").status, "passed");
  assert.equal(flag(fields, "grab-location").status, "passed");
});

test("incomplete charge extraction is pending and never scored as a mismatch", () => {
  const fields: ExtractedFields = {
    total: 22.1,
    lineItems: [
      { description: "Fare", amount: 20.1 },
      { description: "Platform fee", amount: 1.2 },
    ],
    grab: {
      receiptKind: "transport",
      bookingId: "A-456",
      serviceType: "JustGrab",
      pickup: "A",
      dropoff: "B",
      lineItemsComplete: false,
    },
  };

  const arithmetic = flag(fields, "grab-arithmetic");
  assert.equal(arithmetic.status, "pending");
  assert.notEqual(arithmetic.status, "triggered");
});

test("GrabFood does not require transport pickup and drop-off fields", () => {
  const fields: ExtractedFields = {
    merchant: "Example Restaurant",
    address: "10 Example Street",
    total: 18,
    lineItems: [
      { description: "Meal", amount: 15 },
      { description: "Delivery fee", amount: 3 },
    ],
    grab: {
      receiptKind: "food_delivery",
      orderId: "GF-123",
      serviceType: "GrabFood",
      deliveryAddress: "10 Example Street",
      orderDateTime: "2026-06-24T12:00:00+08:00",
      receiptDateTime: "2026-06-24T12:30:00+08:00",
      lineItemsComplete: true,
    },
  };

  assert.equal(flag(fields, "grab-location").status, "passed");
  assert.equal(flag(fields, "grab-arithmetic").status, "passed");
});

test("parcel delivery accepts a route or a delivery address", () => {
  const fields: ExtractedFields = {
    total: 12,
    lineItems: [{ description: "Delivery charge", amount: 12 }],
    grab: {
      receiptKind: "parcel_delivery",
      orderId: "GE-123",
      serviceType: "GrabExpress",
      deliveryAddress: "20 Destination Road",
      orderDateTime: "2026-06-24T14:00:00+08:00",
      receiptDateTime: "2026-06-24T14:10:00+08:00",
      lineItemsComplete: true,
    },
  };

  assert.equal(flag(fields, "grab-location").status, "passed");
  assert.equal(flag(fields, "grab-arithmetic").status, "passed");
});

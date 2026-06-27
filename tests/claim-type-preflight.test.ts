import assert from "node:assert/strict";
import test from "node:test";
import { claimTypeMismatchMessage, classifyClaimTypeFromText } from "../lib/analysis/claim-type-classifier";

test("detects a Grab receipt from text signals", () => {
  const decision = classifyClaimTypeFromText(`
    Your Grab E-Receipt
    Premium (JustGrab)
    Booking ID: A-123
    Picked up from Tanah Merah
    Drop-off at Pasir Panjang
    Fare 18.40
    Total Paid SGD 21.80
  `);

  assert.equal(decision.detectedType, "grab");
  assert.ok(decision.confidence >= 70);
});

test("detects a medical receipt from text signals", () => {
  const decision = classifyClaimTypeFromText(`
    Example Family Clinic
    Patient: Test User
    Doctor: Dr Tan
    Consultation
    Medication
    Total 48.00
  `);

  assert.equal(decision.detectedType, "medical");
  assert.ok(decision.confidence >= 70);
});

test("keeps unclear text unknown instead of forcing a category", () => {
  const decision = classifyClaimTypeFromText("Thank you. Total 12.00.");

  assert.equal(decision.detectedType, "unknown");
});

test("uses selected claim type in upload guidance", () => {
  assert.equal(claimTypeMismatchMessage("grab"), "Please upload a Grab receipt.");
  assert.equal(claimTypeMismatchMessage("medical"), "Please upload a medical receipt.");
  assert.equal(claimTypeMismatchMessage("purchase"), "Please upload a purchase receipt.");
});

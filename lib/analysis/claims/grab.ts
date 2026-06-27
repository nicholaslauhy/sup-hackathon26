import type { ExtractedFields, Flag } from "../types";
import { missingFieldsFlag } from "./shared";

type GrabFields = NonNullable<ExtractedFields["grab"]>;
type GrabKind = NonNullable<GrabFields["receiptKind"]>;

function receiptKind(fields: ExtractedFields): GrabKind | null {
  const explicit = fields.grab?.receiptKind;
  if (explicit) return explicit;

  const service = fields.grab?.serviceType?.toLowerCase() ?? "";
  if (/(food|mart|restaurant|meal|delivery)/.test(service)) return "food_delivery";
  if (/(express|parcel|courier)/.test(service)) return "parcel_delivery";
  if (fields.grab?.pickup || fields.grab?.dropoff || fields.grab?.fare !== undefined) return "transport";
  return null;
}

function identifierFlag(fields: ExtractedFields, kind: GrabKind | null): Flag {
  const grab = fields.grab ?? {};
  const identifier = kind === "food_delivery" || kind === "parcel_delivery"
    ? grab.orderId ?? grab.bookingId
    : grab.bookingId ?? grab.orderId;

  return missingFieldsFlag("grab-identifiers", "Grab receipt identifiers", [
    { label: kind === "food_delivery" ? "order ID" : "booking or order ID", value: identifier },
    { label: "service type", value: grab.serviceType },
  ]);
}

function locationFlag(fields: ExtractedFields, kind: GrabKind | null): Flag {
  const pickup = fields.grab?.pickup?.trim();
  const dropoff = fields.grab?.dropoff?.trim();
  const deliveryAddress = fields.grab?.deliveryAddress?.trim() ?? fields.address?.trim();

  if (kind === "food_delivery") {
    if (!fields.merchant || !deliveryAddress) {
      return {
        id: "grab-location",
        title: "GrabFood merchant and delivery details",
        severity: "medium",
        status: "triggered",
        explanation: "A food-delivery receipt should normally identify the merchant and a delivery address.",
        evidence: { merchant: fields.merchant ?? null, deliveryAddress: deliveryAddress ?? null },
      };
    }
    return {
      id: "grab-location",
      title: "GrabFood merchant and delivery details present",
      severity: "info",
      status: "passed",
      explanation: "The merchant and delivery address were extracted.",
      evidence: { merchant: fields.merchant, deliveryAddress },
    };
  }

  if (kind === "parcel_delivery") {
    if ((!pickup || !dropoff) && !deliveryAddress) {
      return {
        id: "grab-location",
        title: "Parcel route or delivery address missing",
        severity: "medium",
        status: "triggered",
        explanation: "A parcel-delivery receipt should normally identify its route or delivery address.",
      };
    }
    return {
      id: "grab-location",
      title: "Parcel delivery location details present",
      severity: "info",
      status: "passed",
      explanation: "A pickup/drop-off route or delivery address was extracted.",
      evidence: { pickup: pickup ?? null, dropoff: dropoff ?? null, deliveryAddress: deliveryAddress ?? null },
    };
  }

  if (kind !== "transport") {
    return {
      id: "grab-location",
      title: "Grab service location check",
      severity: "medium",
      status: "pending",
      explanation: "The Grab service type was not clear enough to decide which location fields are required.",
    };
  }

  if (!pickup || !dropoff) {
    return {
      id: "grab-location",
      title: "Pickup and drop-off details",
      severity: "medium",
      status: "triggered",
      explanation: "A Grab transport receipt should normally identify both pickup and drop-off locations.",
      evidence: { pickup: pickup ?? null, dropoff: dropoff ?? null },
    };
  }
  if (pickup.toLowerCase() === dropoff.toLowerCase()) {
    return {
      id: "grab-location",
      title: "Pickup and drop-off are identical",
      severity: "medium",
      status: "triggered",
      explanation: "The extracted pickup and drop-off locations are identical and should be checked manually.",
      evidence: { pickup, dropoff },
    };
  }
  return {
    id: "grab-location",
    title: "Pickup and drop-off are present",
    severity: "info",
    status: "passed",
    explanation: "Distinct pickup and drop-off locations were extracted.",
    evidence: { pickup, dropoff },
  };
}

function timingFlag(fields: ExtractedFields, kind: GrabKind | null): Flag {
  const eventValue = kind === "food_delivery" || kind === "parcel_delivery"
    ? fields.grab?.orderDateTime ?? fields.grab?.tripDateTime
    : fields.grab?.tripDateTime ?? fields.grab?.orderDateTime;
  const receiptValue = fields.grab?.receiptDateTime ?? fields.date;
  const eventLabel = kind === "transport" ? "trip" : "order";

  if (!eventValue || !receiptValue) {
    return {
      id: "grab-timing",
      title: `Grab ${eventLabel} and receipt timing`,
      severity: "medium",
      status: "pending",
      explanation: `Both ${eventLabel} time and receipt time are needed to check their ordering.`,
    };
  }
  const eventTime = new Date(eventValue);
  const receipt = new Date(receiptValue);
  if (Number.isNaN(eventTime.getTime()) || Number.isNaN(receipt.getTime())) {
    return {
      id: "grab-timing",
      title: `Grab ${eventLabel} and receipt timing`,
      severity: "medium",
      status: "pending",
      explanation: "The extracted timestamps could not be interpreted reliably.",
      evidence: { eventDateTime: eventValue, receiptDateTime: receiptValue },
    };
  }
  if (receipt.getTime() < eventTime.getTime()) {
    return {
      id: "grab-timing",
      title: `Receipt predates the ${eventLabel}`,
      severity: "high",
      status: "triggered",
      explanation: `The receipt timestamp is earlier than the stated ${eventLabel} timestamp.`,
      evidence: { eventDateTime: eventValue, receiptDateTime: receiptValue },
    };
  }
  return {
    id: "grab-timing",
    title: `Grab ${eventLabel} and receipt timing is consistent`,
    severity: "info",
    status: "passed",
    explanation: `The receipt was generated at or after the stated ${eventLabel} time.`,
    evidence: { eventDateTime: eventValue, receiptDateTime: receiptValue },
  };
}

function monetaryFlag(fields: ExtractedFields): Flag {
  const grab = fields.grab ?? {};
  const lineItems = fields.lineItems ?? [];
  const complete = grab.lineItemsComplete === true;

  if (fields.total === undefined || lineItems.length === 0 || !complete) {
    const extractedTotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
    return {
      id: "grab-arithmetic",
      title: "Grab charge breakdown incomplete",
      severity: "medium",
      status: "pending",
      explanation: "Every displayed monetary row must be extracted before the checker can make a reliable arithmetic judgment. Incomplete extraction is not scored as fraud risk.",
      evidence: {
        extractedRows: lineItems.length,
        extractedRowsTotal: lineItems.length ? Number(extractedTotal.toFixed(2)) : null,
        displayedTotal: fields.total ?? null,
        lineItemsComplete: grab.lineItemsComplete ?? null,
      },
    };
  }

  const expected = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const mismatch = Math.abs(expected - fields.total) > 0.02;
  return mismatch
    ? {
        id: "grab-arithmetic",
        title: "Grab charges do not reconcile",
        severity: "high",
        status: "triggered",
        explanation: "All visible charge rows were extracted, but their signed sum does not match the displayed total.",
        evidence: {
          calculationSource: "complete extracted charge rows",
          calculatedTotal: Number(expected.toFixed(2)),
          displayedTotal: fields.total,
          difference: Number((fields.total - expected).toFixed(2)),
        },
      }
    : {
        id: "grab-arithmetic",
        title: "Grab charges reconcile",
        severity: "info",
        status: "passed",
        explanation: "All extracted charges and discounts add up to the displayed total.",
        evidence: {
          calculationSource: "complete extracted charge rows",
          calculatedTotal: Number(expected.toFixed(2)),
          displayedTotal: fields.total,
        },
      };
}

export function grabClaimFlags(fields: ExtractedFields): Flag[] {
  const kind = receiptKind(fields);
  return [
    {
      id: "grab-service-kind",
      title: kind ? `Grab ${kind.replaceAll("_", " ")} receipt` : "Grab service type unclear",
      severity: "info",
      status: kind ? "passed" : "pending",
      explanation: kind
        ? "The claim-specific checks were selected for this Grab service category."
        : "The service category could not be classified confidently, so service-specific requirements remain conservative.",
      evidence: { receiptKind: kind, serviceType: fields.grab?.serviceType ?? null },
    },
    identifierFlag(fields, kind),
    locationFlag(fields, kind),
    timingFlag(fields, kind),
    monetaryFlag(fields),
  ];
}

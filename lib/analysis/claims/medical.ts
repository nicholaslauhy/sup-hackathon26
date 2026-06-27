import type { ExtractedFields, Flag } from "../types";
import { arithmeticFlag, missingFieldsFlag } from "./shared";

function afterHoursFlag(value: string | undefined): Flag {
  if (!value) {
    return {
      id: "medical-timing",
      title: "Visit timing",
      severity: "low",
      status: "pending",
      explanation: "No reliable visit date and time was extracted.",
    };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      id: "medical-timing",
      title: "Visit timing",
      severity: "low",
      status: "pending",
      explanation: "The extracted visit date could not be interpreted reliably.",
      evidence: { visitDateTime: value },
    };
  }
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const includesTime = /[T ]\d{1,2}:\d{2}/.test(value);
  const afterHours = includesTime && (date.getHours() < 7 || date.getHours() >= 22);
  if (weekend || afterHours) {
    return {
      id: "medical-timing",
      title: "Weekend or after-hours visit",
      severity: "low",
      status: "triggered",
      explanation: "The stated visit time is outside ordinary weekday clinic hours. This is contextual only because genuine emergency and extended-hours care is common.",
      evidence: { visitDateTime: value, weekend, afterHours },
    };
  }
  return {
    id: "medical-timing",
    title: "Visit time is within ordinary hours",
    severity: "info",
    status: "passed",
    explanation: "The stated visit time falls within the deliberately broad ordinary-hours window.",
    evidence: { visitDateTime: value },
  };
}

export function medicalClaimFlags(fields: ExtractedFields): Flag[] {
  const medical = fields.medical ?? {};
  const registrationFlag: Flag = medical.registrationNumber
    ? {
        id: "medical-registration",
        title: "Clinic registration details present",
        severity: "info",
        status: "passed",
        explanation: "A clinic registration or GST identifier was extracted.",
        evidence: { registrationNumber: medical.registrationNumber },
      }
    : {
        id: "medical-registration",
        title: "Clinic registration details missing",
        severity: "low",
        status: "triggered",
        explanation: "No clinic registration or GST identifier was found. Some genuine medical receipts omit this, so it is a weak contextual signal.",
      };
  return [
    missingFieldsFlag("medical-identifiers", "Medical claim identifiers", [
      { label: "clinic name", value: medical.clinicName ?? fields.merchant },
      { label: "visit date", value: medical.visitDateTime ?? fields.date },
      { label: "receipt or invoice number", value: fields.receiptNumber },
    ]),
    registrationFlag,
    arithmeticFlag(fields, "medical-arithmetic"),
    afterHoursFlag(medical.visitDateTime ?? fields.date),
  ];
}

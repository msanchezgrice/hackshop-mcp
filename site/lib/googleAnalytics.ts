export const DEFAULT_GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-VWF1CCVR6T";

const measurementIdPattern = /^G-[A-Z0-9]+$/;

export function getGoogleAnalyticsMeasurementId(
  configuredId: string | undefined,
): string {
  const normalized = configuredId?.trim().toUpperCase();
  return normalized && measurementIdPattern.test(normalized)
    ? normalized
    : DEFAULT_GOOGLE_ANALYTICS_MEASUREMENT_ID;
}

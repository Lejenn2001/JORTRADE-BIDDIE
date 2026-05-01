export function getPolygonKey(): string {
  if (process.env["NODE_ENV"] === "production") {
    return process.env["POLYGON_API_KEY"] ?? "";
  }
  return process.env["POLYGON_API_KEY_DEV"] ?? process.env["POLYGON_API_KEY"] ?? "";
}

export function isUsingDevKey(): boolean {
  return process.env["NODE_ENV"] !== "production" && !!process.env["POLYGON_API_KEY_DEV"];
}

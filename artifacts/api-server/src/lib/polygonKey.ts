export function getPolygonKey(): string {
  // Override wins everywhere (dev + prod). Used to swap in a fresh, valid key
  // without fighting a locked/stale POLYGON_API_KEY secret entry.
  const override = process.env["POLYGON_API_KEY_OVERRIDE"];
  if (override) return override;
  if (process.env["NODE_ENV"] === "production") {
    return process.env["POLYGON_API_KEY"] ?? "";
  }
  return process.env["POLYGON_API_KEY_DEV"] ?? process.env["POLYGON_API_KEY"] ?? "";
}

export function isUsingDevKey(): boolean {
  return process.env["NODE_ENV"] !== "production" && !!process.env["POLYGON_API_KEY_DEV"];
}

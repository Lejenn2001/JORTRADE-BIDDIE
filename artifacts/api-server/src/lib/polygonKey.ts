export function getPolygonKey(): string {
  // Polygon allows only ONE live WebSocket connection per API key. The deployed
  // (production) app and this dev workspace must therefore use DIFFERENT keys, or
  // they fight over the single connection slot and both get kicked (close 1008).
  if (process.env["NODE_ENV"] === "production") {
    return (
      process.env["POLYGON_API_KEY_PROD"] ??
      process.env["POLYGON_API_KEY_OVERRIDE"] ??
      process.env["POLYGON_API_KEY"] ??
      ""
    );
  }
  // Dev prefers its own dedicated key so it never collides with the live app.
  return (
    process.env["POLYGON_API_KEY_DEV_OVERRIDE"] ??
    process.env["POLYGON_API_KEY_OVERRIDE"] ??
    process.env["POLYGON_API_KEY_DEV"] ??
    process.env["POLYGON_API_KEY"] ??
    ""
  );
}

export function isUsingDevKey(): boolean {
  return (
    process.env["NODE_ENV"] !== "production" &&
    (!!process.env["POLYGON_API_KEY_DEV_OVERRIDE"] || !!process.env["POLYGON_API_KEY_DEV"])
  );
}

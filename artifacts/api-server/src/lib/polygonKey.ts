export function getPolygonKey(): string {
  // Polygon allows only ONE live WebSocket connection per ACCOUNT (not per key).
  // The deployed (production) app and this dev workspace must therefore use keys
  // from DIFFERENT Polygon accounts, or they fight over the single connection
  // slot and both get kicked (close 1008). A second key on the SAME account does
  // NOT get its own slot — see priceMonitor.ts for the WS gating that enforces this.
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

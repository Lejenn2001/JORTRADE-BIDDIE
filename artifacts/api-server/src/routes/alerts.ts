import { Router } from "express";
import pg from "pg";

const router = Router();
const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });

router.get("/alerts", async (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  try {
    const { rows } = await pool.query(
      `SELECT * FROM user_price_alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );
    res.json({ alerts: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/alerts", async (req, res) => {
  const { userId, ticker, targetPrice, condition, signalId, label } = req.body;
  if (!userId || !ticker || !targetPrice || !condition) {
    res.status(400).json({ error: "userId, ticker, targetPrice, condition required" });
    return;
  }
  if (!["above", "below"].includes(condition)) {
    res.status(400).json({ error: "condition must be 'above' or 'below'" });
    return;
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO user_price_alerts (user_id, ticker, target_price, condition, signal_id, label)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, ticker.toUpperCase(), targetPrice, condition, signalId || null, label || null]
    );
    res.json({ alert: rows[0] });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/alerts/:id", async (req, res) => {
  const { id } = req.params;
  const userId = req.query.userId as string;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  try {
    await pool.query(
      `DELETE FROM user_price_alerts WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/alerts/check-prices", async (req, res) => {
  const { prices } = req.body;
  if (!prices || typeof prices !== "object") {
    res.status(400).json({ error: "prices object required" });
    return;
  }
  try {
    const { rows: activeAlerts } = await pool.query(
      `SELECT * FROM user_price_alerts WHERE active = true AND triggered = false`
    );
    const triggered: any[] = [];
    for (const alert of activeAlerts) {
      const price = prices[alert.ticker];
      if (price == null) continue;
      const target = parseFloat(alert.target_price);
      const hit = alert.condition === "above" ? price >= target : price <= target;
      if (hit) {
        await pool.query(
          `UPDATE user_price_alerts SET triggered = true, triggered_at = now(), triggered_price = $1, active = false WHERE id = $2`,
          [price, alert.id]
        );
        await pool.query(
          `INSERT INTO signal_alerts (ticker, alert_type, message, signal_id)
           VALUES ($1, 'price_alert', $2, $3)`,
          [
            alert.ticker,
            `🔔 ${alert.ticker} hit $${price.toFixed(2)} (alert: ${alert.condition} $${target.toFixed(2)}${alert.label ? ' — ' + alert.label : ''})`,
            alert.signal_id || null,
          ]
        );
        triggered.push({ ...alert, triggered_price: price });
      }
    }
    res.json({ checked: activeAlerts.length, triggered: triggered.length, alerts: triggered });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

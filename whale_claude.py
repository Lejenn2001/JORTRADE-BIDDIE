#!/usr/bin/env python3
"""
Unusual Whales + Claude AI Analysis Tool
Fetches real market intelligence from Unusual Whales, analyzes with Claude, and alerts to Discord.

Usage:
  python whale_claude.py flow                         # Options flow alerts
  python whale_claude.py flow --limit 100 --discord   # With Discord alert
  python whale_claude.py market                       # Sectors, economic & FDA calendar
  python whale_claude.py market --discord             # With Discord alert
  python whale_claude.py darkpool AAPL               # Dark pool for a ticker
  python whale_claude.py darkpool NVDA --discord     # With Discord alert
  python whale_claude.py stock TSLA                  # Full stock deep-dive
  python whale_claude.py stock TSLA --discord        # With Discord alert
  python whale_claude.py monitor                     # Auto-run flow every hour
  python whale_claude.py monitor --interval 30       # Every 30 minutes
"""

import os
import sys
import json
import time
import argparse
from datetime import datetime
import requests
import anthropic
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.markdown import Markdown

console = Console()

# ── Configuration ─────────────────────────────────────────────────────────────

UW_API_KEY = os.environ.get("UNUSUAL_WHALES_API_KEY")
ANTHROPIC_API_KEY = os.environ.get("AI_INTEGRATIONS_ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
ANTHROPIC_BASE_URL = os.environ.get("AI_INTEGRATIONS_ANTHROPIC_BASE_URL")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")

if not UW_API_KEY:
    console.print("[bold red]Error:[/] UNUSUAL_WHALES_API_KEY is not set.")
    sys.exit(1)

if not ANTHROPIC_API_KEY:
    console.print("[bold red]Error:[/] No Anthropic API key found.")
    sys.exit(1)

UW_BASE = "https://api.unusualwhales.com"
UW_HEADERS = {"Authorization": f"Bearer {UW_API_KEY}", "Accept": "application/json"}

claude_kwargs = {"api_key": ANTHROPIC_API_KEY}
if ANTHROPIC_BASE_URL:
    claude_kwargs["base_url"] = ANTHROPIC_BASE_URL

claude = anthropic.Anthropic(**claude_kwargs)

# ── Discord Helpers ───────────────────────────────────────────────────────────

DISCORD_COLOR = {
    "flow":     0xF4A700,   # gold
    "market":   0x5865F2,   # blurple
    "darkpool": 0x57F287,   # green
    "stock":    0xEB459E,   # pink
    "monitor":  0xFEE75C,   # yellow
}

DISCORD_MAX = 4000   # max chars in a Discord embed description


def _chunk_text(text: str, limit: int = DISCORD_MAX) -> list[str]:
    """Split long text into chunks that fit in Discord embeds."""
    lines, chunks, current = text.splitlines(keepends=True), [], ""
    for line in lines:
        if len(current) + len(line) > limit:
            chunks.append(current)
            current = line
        else:
            current += line
    if current:
        chunks.append(current)
    return chunks or ["(no content)"]


def send_discord(title: str, analysis: str, command: str, ticker: str = None) -> bool:
    """
    Send analysis to Discord via webhook.
    Returns True on success, False otherwise.
    """
    if not DISCORD_WEBHOOK_URL:
        console.print("[yellow]⚠ Discord webhook not configured.[/] Set DISCORD_WEBHOOK_URL to enable alerts.")
        return False

    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    color = DISCORD_COLOR.get(command, 0x9E9E9E)
    chunks = _chunk_text(analysis)

    # First embed has the title and first chunk
    embeds = [{
        "title": f"🐋  {title}",
        "description": chunks[0],
        "color": color,
        "footer": {"text": f"Unusual Whales + Claude AI  •  {timestamp}"},
    }]

    # Extra chunks become continuation embeds (no title)
    for chunk in chunks[1:]:
        embeds.append({
            "description": chunk,
            "color": color,
        })

    # Discord allows up to 10 embeds per message
    for i in range(0, len(embeds), 10):
        batch = embeds[i:i + 10]
        payload = {"embeds": batch}
        if ticker:
            payload["content"] = f"**{ticker}** analysis ready"

        try:
            r = requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
            r.raise_for_status()
        except requests.exceptions.RequestException as e:
            console.print(f"[bold red]Discord send failed:[/] {e}")
            return False

    console.print("[bold green]✓ Alert sent to Discord![/]")
    return True


# ── Unusual Whales Fetch Helpers ─────────────────────────────────────────────

def uw_get(path: str, params: dict = None) -> dict | list | None:
    url = f"{UW_BASE}{path}"
    try:
        r = requests.get(url, headers=UW_HEADERS, params=params, timeout=15)
        r.raise_for_status()
        return r.json()
    except requests.exceptions.HTTPError:
        if r.status_code != 404:
            console.print(f"[bold red]API Error {r.status_code}:[/] {r.text[:200]}")
        return None
    except requests.exceptions.RequestException as e:
        console.print(f"[bold red]Request failed:[/] {e}")
        return None


def fetch_flow_alerts(limit: int = 50) -> list:
    data = uw_get("/api/option-trades/flow-alerts", {"limit": limit})
    if data is None:
        return []
    return data.get("data", data) if isinstance(data, dict) else data


def fetch_sector_etfs() -> list:
    data = uw_get("/api/market/sector-etfs")
    if data is None:
        return []
    return data.get("data", data) if isinstance(data, dict) else data


def fetch_economic_calendar() -> list:
    data = uw_get("/api/market/economic-calendar")
    if data is None:
        return []
    return data.get("data", data) if isinstance(data, dict) else data


def fetch_fda_calendar() -> list:
    data = uw_get("/api/market/fda-calendar")
    if data is None:
        return []
    return data.get("data", data) if isinstance(data, dict) else data


def fetch_darkpool(ticker: str, limit: int = 40) -> list:
    data = uw_get(f"/api/darkpool/{ticker.upper()}", {"limit": limit})
    if data is None:
        return []
    return data.get("data", data) if isinstance(data, dict) else data


def fetch_flow_for_ticker(ticker: str, all_alerts: list) -> list:
    return [a for a in all_alerts if str(a.get("ticker", "")).upper() == ticker.upper()]


# ── Claude Analysis ───────────────────────────────────────────────────────────

def analyze_with_claude(system_prompt: str, user_content: str, title: str) -> str:
    console.print(f"\n[bold cyan]Sending data to Claude for analysis...[/]\n")
    try:
        with console.status("[bold green]Claude is thinking...[/]", spinner="dots"):
            message = claude.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=8192,
                system=system_prompt,
                messages=[{"role": "user", "content": user_content}],
            )
        response_text = message.content[0].text
        console.print(Panel(
            Markdown(response_text),
            title=f"[bold magenta]{title}[/]",
            border_style="magenta",
            padding=(1, 2),
        ))
        return response_text
    except anthropic.APIError as e:
        console.print(f"[bold red]Claude API error:[/] {e}")
        return ""


# ── Display Helpers ───────────────────────────────────────────────────────────

def trunc(val, n=35):
    s = str(val) if val is not None else "—"
    return s[:n] + "…" if len(s) > n else s


def show_table(title: str, rows: list, columns: list[tuple[str, str]], max_rows: int = 20):
    if not rows:
        console.print(f"[yellow]No data for:[/] {title}")
        return
    table = Table(title=title, show_lines=True, border_style="blue")
    for header, _ in columns:
        table.add_column(header, overflow="fold")
    for row in rows[:max_rows]:
        table.add_row(*[trunc(row.get(key)) for _, key in columns])
    console.print(table)


# ── Commands ─────────────────────────────────────────────────────────────────

def cmd_flow(args):
    console.print(Panel("[bold yellow]Fetching Options Flow Alerts from Unusual Whales...[/]", border_style="yellow"))
    alerts = fetch_flow_alerts(limit=args.limit)

    if not alerts:
        console.print("[red]No flow alert data returned.[/]")
        return

    show_table(
        "Options Flow Alerts",
        alerts,
        [
            ("Ticker", "ticker"),
            ("Type", "type"),
            ("Strike", "strike"),
            ("Expiry", "expiry"),
            ("Premium", "total_premium"),
            ("Volume", "volume"),
            ("OI", "open_interest"),
            ("Vol/OI", "volume_oi_ratio"),
            ("Rule", "alert_rule"),
            ("Underlying", "underlying_price"),
        ],
    )

    data_str = json.dumps(alerts[:40], indent=2, default=str)
    title = "Options Flow Analysis"

    analysis = analyze_with_claude(
        system_prompt=(
            "You are an expert options trader and institutional flow analyst. "
            "You specialize in reading unusual options activity to identify smart money positioning, "
            "bullish/bearish sentiment, and near-term price catalysts. "
            "Be specific and actionable. Use clear Markdown headers and bullet points."
        ),
        user_content=(
            f"Here is real-time unusual options flow data from Unusual Whales "
            f"(fetched {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}):\n\n"
            f"```json\n{data_str}\n```\n\n"
            "Please analyze this flow data and provide:\n"
            "## 1. Most Notable Trades\n"
            "Highlight the top 5 most significant or unusual positions.\n\n"
            "## 2. Bullish vs Bearish Sentiment\n"
            "Overall market mood based on call/put activity and premium flow.\n\n"
            "## 3. Sector & Theme Concentration\n"
            "Any sectors or themes showing concentrated unusual activity.\n\n"
            "## 4. Key Tickers to Watch\n"
            "The stocks with the strongest institutional interest right now.\n\n"
            "## 5. Risk Flags\n"
            "Warning signs, unusual put protection, or macro hedging patterns.\n"
        ),
        title=title,
    )

    if getattr(args, "discord", False) and analysis:
        send_discord(title, analysis, "flow")


def cmd_market(args):
    console.print(Panel("[bold yellow]Fetching Market Intelligence from Unusual Whales...[/]", border_style="yellow"))

    sectors = fetch_sector_etfs()
    econ = fetch_economic_calendar()
    fda = fetch_fda_calendar()

    if sectors:
        show_table(
            "Sector ETF Activity",
            sectors,
            [
                ("ETF", "ticker"),
                ("Name", "full_name"),
                ("Last", "last"),
                ("Open", "open"),
                ("High", "high"),
                ("Low", "low"),
                ("Volume", "volume"),
                ("Call Vol", "call_volume"),
                ("Put Vol", "put_volume"),
            ],
        )

    if econ:
        show_table(
            "Economic Calendar",
            econ,
            [
                ("Event", "event"),
                ("Time", "time"),
                ("Forecast", "forecast"),
                ("Previous", "prev"),
                ("Period", "reported_period"),
            ],
            max_rows=10,
        )

    if fda:
        show_table(
            "FDA Calendar",
            fda,
            [
                ("Ticker", "ticker"),
                ("Event", "event_type"),
                ("Description", "description"),
                ("Status", "status"),
                ("Time", "time"),
            ],
            max_rows=10,
        )

    if not sectors and not econ and not fda:
        console.print("[red]No market data returned.[/]")
        return

    combined = {
        "sector_etfs": sectors[:12] if sectors else [],
        "economic_calendar": econ[:10] if econ else [],
        "fda_calendar": fda[:10] if fda else [],
        "fetched_at": datetime.utcnow().isoformat(),
    }
    data_str = json.dumps(combined, indent=2, default=str)
    title = "Market Intelligence Briefing"

    analysis = analyze_with_claude(
        system_prompt=(
            "You are a macro market strategist who interprets sector flows, economic catalysts, "
            "and biotech event risk. You give traders a concise, structured market briefing "
            "that helps them position for the session. Be direct and actionable."
        ),
        user_content=(
            f"Here is today's market intelligence from Unusual Whales "
            f"(fetched {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}):\n\n"
            f"```json\n{data_str}\n```\n\n"
            "Please provide a complete market briefing:\n"
            "## 1. Overall Market Sentiment\n"
            "Risk-on or risk-off? Key signals from sector ETF flow.\n\n"
            "## 2. Sector Rotation\n"
            "Which sectors are leading vs lagging? Notable call/put flow by sector.\n\n"
            "## 3. Economic Catalysts\n"
            "Upcoming economic events that could move markets. What to watch.\n\n"
            "## 4. Biotech / FDA Events\n"
            "FDA catalysts worth knowing. Potential binary events.\n\n"
            "## 5. Trading Focus for Today\n"
            "Top 3 themes or setups to focus on based on all this data.\n"
        ),
        title=title,
    )

    if getattr(args, "discord", False) and analysis:
        send_discord(title, analysis, "market")


def cmd_darkpool(args):
    ticker = args.ticker.upper()
    console.print(Panel(f"[bold yellow]Fetching Dark Pool Data for [white]{ticker}[/]...[/]", border_style="yellow"))

    transactions = fetch_darkpool(ticker=ticker, limit=args.limit)

    if not transactions:
        console.print(f"[red]No dark pool data found for {ticker}.[/]")
        return

    show_table(
        f"{ticker} Dark Pool Transactions",
        transactions,
        [
            ("Size", "size"),
            ("Price", "price"),
            ("Premium", "premium"),
            ("Exchange", "market_center"),
            ("NBBO Bid", "nbbo_bid"),
            ("NBBO Ask", "nbbo_ask"),
            ("Settlement", "trade_settlement"),
            ("Time", "executed_at"),
        ],
    )

    total_premium = sum(float(t.get("premium", 0) or 0) for t in transactions)
    total_size = sum(int(t.get("size", 0) or 0) for t in transactions)
    avg_price = sum(float(t.get("price", 0) or 0) for t in transactions) / max(len(transactions), 1)

    summary_stats = {
        "ticker": ticker,
        "transaction_count": len(transactions),
        "total_shares": total_size,
        "total_premium_usd": round(total_premium, 2),
        "avg_execution_price": round(avg_price, 4),
        "sample_transactions": transactions[:20],
    }

    data_str = json.dumps(summary_stats, indent=2, default=str)
    title = f"{ticker} Dark Pool Analysis"

    analysis = analyze_with_claude(
        system_prompt=(
            f"You are a dark pool and institutional equity analyst specializing in {ticker}. "
            "You interpret off-exchange block trades to identify stealth accumulation, "
            "distribution, and institutional conviction. Be precise and insightful."
        ),
        user_content=(
            f"Here is recent dark pool transaction data for {ticker} from Unusual Whales "
            f"(fetched {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}):\n\n"
            f"```json\n{data_str}\n```\n\n"
            f"Please analyze the {ticker} dark pool activity:\n"
            "## 1. Accumulation vs Distribution\n"
            "Are institutions buying or selling? Support your answer with the data.\n\n"
            "## 2. Largest Block Trades\n"
            "Highlight the most significant prints and what they suggest.\n\n"
            "## 3. Price Discovery\n"
            "How are dark pool execution prices comparing to NBBO? What does this signal?\n\n"
            "## 4. Volume Context\n"
            "Is today's dark pool volume elevated or normal for this stock?\n\n"
            "## 5. Institutional Thesis\n"
            "Based on this data, what do large players appear to be positioning for?\n"
        ),
        title=title,
    )

    if getattr(args, "discord", False) and analysis:
        send_discord(title, analysis, "darkpool", ticker=ticker)


def cmd_stock(args):
    ticker = args.ticker.upper()
    console.print(Panel(f"[bold yellow]Running Deep Dive on [white]{ticker}[/]...[/]", border_style="yellow"))

    console.print("[dim]Fetching flow alerts...[/]")
    all_alerts = fetch_flow_alerts(limit=200)
    ticker_flow = fetch_flow_for_ticker(ticker, all_alerts)

    console.print("[dim]Fetching dark pool data...[/]")
    darkpool = fetch_darkpool(ticker, limit=30)

    console.print("[dim]Fetching sector context...[/]")
    sectors = fetch_sector_etfs()

    if ticker_flow:
        show_table(
            f"{ticker} Options Flow Alerts",
            ticker_flow,
            [
                ("Type", "type"),
                ("Strike", "strike"),
                ("Expiry", "expiry"),
                ("Premium", "total_premium"),
                ("Volume", "volume"),
                ("OI", "open_interest"),
                ("Vol/OI", "volume_oi_ratio"),
                ("Rule", "alert_rule"),
            ],
        )
    else:
        console.print(f"[yellow]No flow alerts found for {ticker} in recent data.[/]")

    if darkpool:
        show_table(
            f"{ticker} Dark Pool",
            darkpool,
            [("Size", "size"), ("Price", "price"), ("Premium", "premium"), ("Time", "executed_at")],
            max_rows=10,
        )

    combined = {
        "ticker": ticker,
        "options_flow_alerts": ticker_flow[:30],
        "darkpool_transactions": darkpool[:20],
        "market_sector_context": sectors[:5] if sectors else [],
        "fetched_at": datetime.utcnow().isoformat(),
    }
    data_str = json.dumps(combined, indent=2, default=str)
    title = f"{ticker} Deep Dive"

    analysis = analyze_with_claude(
        system_prompt=(
            f"You are a specialist equity and options analyst focused on {ticker}. "
            "You combine real options flow intelligence, dark pool data, and market context "
            "to give traders a comprehensive, actionable picture of the stock. "
            "Be specific. Reference actual numbers from the data."
        ),
        user_content=(
            f"Here is comprehensive real-time data for {ticker} from Unusual Whales "
            f"(fetched {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}):\n\n"
            f"```json\n{data_str}\n```\n\n"
            f"Please provide a complete {ticker} analysis:\n"
            "## 1. Options Flow Summary\n"
            "What are options traders betting on? Calls vs puts, strikes, expirations.\n\n"
            "## 2. Unusual Activity\n"
            "Highlight any flow that stands out as potentially informed or institutional.\n\n"
            "## 3. Dark Pool Intelligence\n"
            "What does the dark pool data tell us about institutional positioning?\n\n"
            "## 4. Combined Signal\n"
            "When you combine the options flow and dark pool data, what is the overall picture?\n\n"
            "## 5. Key Levels & Expirations to Watch\n"
            "Important strikes, expirations, or price levels based on the positioning data.\n"
        ),
        title=title,
    )

    if getattr(args, "discord", False) and analysis:
        send_discord(title, analysis, "stock", ticker=ticker)


def cmd_jortrade(args):
    """JORTRADE: High-conviction options setups from whale flow across all tickers."""
    console.print(Panel(
        "[bold yellow]JORTRADE — Scanning Whale Flow for High-Conviction Setups...[/]",
        border_style="yellow",
    ))

    alerts = fetch_flow_alerts(limit=200)

    if not alerts:
        console.print("[red]No flow data found. Try again during market hours.[/]")
        return

    enriched = []
    for x in alerts:
        prem = float(x.get("total_premium", 0) or 0)
        ask_prem = float(x.get("total_ask_side_prem", 0) or 0)
        vol = int(x.get("volume", 0) or 0)
        oi = int(x.get("open_interest", 0) or 0)
        enriched.append({
            "ticker": x.get("ticker"),
            "type": x.get("type"),
            "strike": x.get("strike"),
            "expiry": x.get("expiry"),
            "underlying_price": x.get("underlying_price"),
            "total_premium": prem,
            "ask_side_prem": ask_prem,
            "bid_side_prem": float(x.get("total_bid_side_prem", 0) or 0),
            "ask_aggression_pct": round(ask_prem / max(prem, 1) * 100, 1),
            "volume": vol,
            "open_interest": oi,
            "vol_oi_ratio": round(vol / max(oi, 1), 2),
            "alert_rule": x.get("alert_rule"),
            "has_sweep": x.get("has_sweep"),
            "has_floor": x.get("has_floor"),
            "trade_count": x.get("trade_count"),
            "iv": x.get("iv_end"),
            "next_earnings": x.get("next_earnings_date"),
        })

    enriched.sort(key=lambda x: x["total_premium"], reverse=True)

    show_table(
        "JORTRADE — All Unusual Flow",
        enriched,
        [
            ("Ticker", "ticker"),
            ("Type", "type"),
            ("Strike", "strike"),
            ("Expiry", "expiry"),
            ("Premium", "total_premium"),
            ("Ask%", "ask_aggression_pct"),
            ("Vol/OI", "vol_oi_ratio"),
            ("Sweep", "has_sweep"),
            ("Rule", "alert_rule"),
        ],
    )

    data_str = json.dumps(enriched, indent=2, default=str)
    title = "JORTRADE — High-Conviction Setups"

    analysis = analyze_with_claude(
        system_prompt=(
            "You are a professional institutional options flow analyst for JORTRADE.\n\n"
            "Your job is to identify ONLY HIGH-CONVICTION trade ideas from unusual whale activity.\n\n"
            "Analyze the provided whale flow and return ONLY trades with a confidence score of 7, 8, 9, or 10. "
            "Ignore all lower-confidence setups.\n\n"
            "You may recommend trades on ANY ticker in the data — not just large caps. "
            "If a smaller or mid-cap name shows elite-quality flow (massive sweeps, huge vol/OI, stacked aggression), include it.\n\n"
            "Prioritize flow that shows strong directional intent:\n"
            "- repeated sweeps or aggressive orders at the ask\n"
            "- large premium trades\n"
            "- volume greater than open interest\n"
            "- multiple orders at the same strike or expiration\n"
            "- stacked flow in one direction\n"
            "- contracts close enough to current price to matter TODAY\n"
            "- flow near major support/resistance, prior day high/low, VWAP, or breakout levels\n\n"
            "Downgrade or ignore:\n"
            "- far out-of-the-money lotto flow\n"
            "- very small premium trades\n"
            "- mixed bullish and bearish activity with no clear bias\n"
            "- likely hedging or volatility positioning\n"
            "- illiquid tickers with no real follow-through potential\n\n"
            "For each qualifying setup choose the BEST trade structure based on the flow:\n"
            "- Buying calls outright — when flow is explosive, sweeps are massive, or 0DTE momentum matters\n"
            "- Buying puts outright — when bearish flow is aggressive and near-term\n"
            "- Call debit spread — when bullish but you want defined risk with a near target\n"
            "- Put debit spread — when bearish with a defined downside target\n"
            "- Butterfly — when flow clusters tightly at one strike suggesting a pin\n\n"
            "Do NOT default to spreads. If the flow screams 'buy the call' or 'buy the put', say that.\n\n"
            "Include BOTH 0DTE opportunities and near-term (1–14 DTE) opportunities when flow supports it.\n\n"
            "Return ONLY the TOP HIGH-CONVICTION setups (as many as clear the 7/10 bar, no minimum, no maximum).\n\n"
            "For each setup provide:\n"
            "- Ticker\n"
            "- Direction: Bullish or Bearish\n"
            "- Suggested Trade: e.g. 'Buy the 645 Put' or '648/642 Put Debit Spread'\n"
            "- Expiration (flag as 0DTE if applicable)\n"
            "- Why this whale flow is meaningful\n"
            "- Key price trigger level\n"
            "- Invalidation level\n"
            "- Confidence score (must be 7–10)\n\n"
            "After listing setups provide:\n"
            "- The SINGLE BEST TRADE for today\n"
            "- Names with heavy flow that should be avoided and why"
        ),
        user_content=(
            f"Here is today's live unusual options flow from Unusual Whales across ALL tickers, "
            f"sorted by premium size (fetched {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}):\n\n"
            f"```json\n{data_str}\n```\n\n"
            "Apply the JORTRADE high-conviction framework. Return ONLY setups scoring 7–10. "
            "Recommend the cleanest trade structure for each — calls, puts, or spreads — based on what the flow actually supports. "
            "Be specific with strikes and expirations. "
            "If no setup clears the 7/10 threshold, say so explicitly rather than forcing lower-quality ideas."
        ),
        title=title,
    )

    if getattr(args, "discord", False) and analysis:
        send_discord(title, analysis, "flow")


def cmd_signal(args):
    """Real-time entry signal detector — ALERT or NO TRADE SIGNAL only."""
    console.print(Panel(
        "[bold cyan]SIGNAL CHECK — Scanning for Trade Entry Conditions...[/]",
        border_style="cyan",
    ))

    alerts = fetch_flow_alerts(limit=200)
    if not alerts:
        console.print("[red]No flow data returned.[/]")
        return

    enriched = []
    for x in alerts:
        prem = float(x.get("total_premium", 0) or 0)
        ask_prem = float(x.get("total_ask_side_prem", 0) or 0)
        vol = int(x.get("volume", 0) or 0)
        oi = int(x.get("open_interest", 0) or 0)
        enriched.append({
            "ticker": x.get("ticker"),
            "type": x.get("type"),
            "strike": x.get("strike"),
            "expiry": x.get("expiry"),
            "underlying_price": x.get("underlying_price"),
            "total_premium": prem,
            "ask_side_prem": ask_prem,
            "bid_side_prem": float(x.get("total_bid_side_prem", 0) or 0),
            "ask_aggression_pct": round(ask_prem / max(prem, 1) * 100, 1),
            "volume": vol,
            "open_interest": oi,
            "vol_oi_ratio": round(vol / max(oi, 1), 2),
            "alert_rule": x.get("alert_rule"),
            "has_sweep": x.get("has_sweep"),
            "has_floor": x.get("has_floor"),
            "trade_count": x.get("trade_count"),
            "iv": x.get("iv_end"),
            "next_earnings": x.get("next_earnings_date"),
        })

    enriched.sort(key=lambda x: x["total_premium"], reverse=True)
    data_str = json.dumps(enriched, indent=2, default=str)
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    try:
        message = anthropic_client.messages.create(
            model="claude-opus-4-5",
            max_tokens=1024,
            system=(
                "You are a real-time options flow trading assistant.\n\n"
                "Your job is NOT to summarize flow.\n"
                "Your job is to determine whether there is a TRADE ENTRY SIGNAL.\n\n"
                "Only generate an alert when ALL of these conditions are met:\n"
                "- High-conviction whale flow (confidence 7–10)\n"
                "- Repeated sweeps or large premium directional trades\n"
                "- Flow aligned with price trend\n"
                "- Price breaking or holding a key level\n"
                "- Strike close enough to matter today\n\n"
                "If ALL conditions are met, respond in EXACTLY this format:\n\n"
                "ALERT\n"
                "Ticker: [TICKER]\n"
                "Direction: Call or Put\n"
                "Trade: [specific strike and expiration]\n"
                "Entry: [price level to enter]\n"
                "Invalidation: [level that kills the trade]\n"
                "Confidence: [7–10]/10\n"
                "Reason: [one sentence max — why this flow is a signal]\n\n"
                "If there are multiple qualifying signals, list each one in the same format.\n\n"
                "If conditions are NOT fully met, respond with ONLY:\n"
                "NO TRADE SIGNAL"
            ),
            messages=[{"role": "user", "content": (
                f"Live unusual options flow from Unusual Whales — ALL tickers, sorted by premium ({now_str}):\n\n"
                f"```json\n{data_str}\n```\n\n"
                "Is there a trade entry signal right now? Apply your criteria strictly. "
                "Return ALERT with details or NO TRADE SIGNAL — nothing else."
            )}],
        )
        result = message.content[0].text.strip()
    except anthropic.APIError as e:
        console.print(f"[bold red]Claude API error:[/] {e}")
        return

    is_alert = result.upper().startswith("ALERT")

    if is_alert:
        console.print(Panel(
            Markdown(result),
            title=f"[bold green]⚡ TRADE SIGNAL DETECTED — {now_str}[/]",
            border_style="green",
            padding=(1, 2),
        ))
        if getattr(args, "discord", False):
            send_discord(f"⚡ TRADE SIGNAL — {now_str}", result, "flow")
    else:
        console.print(Panel(
            "[bold yellow]NO TRADE SIGNAL[/]\n\n[dim]Conditions not fully met. Stand by.[/]",
            title=f"[dim]Signal Check — {now_str}[/]",
            border_style="dim",
            padding=(1, 2),
        ))


def cmd_monitor(args):
    """Continuously run flow analysis on a schedule and post to Discord."""
    interval_mins = args.interval
    use_discord = bool(DISCORD_WEBHOOK_URL)

    if not use_discord:
        console.print(
            "[yellow]⚠ DISCORD_WEBHOOK_URL not set.[/] Monitor will run locally only.\n"
            "Add your webhook URL as a secret to enable Discord alerts."
        )

    console.print(Panel(
        f"[bold green]Monitor Mode Started[/]\n"
        f"Running options flow analysis every [bold]{interval_mins}[/] minutes.\n"
        f"Discord alerts: [bold]{'✓ enabled' if use_discord else '✗ disabled'}[/]\n\n"
        f"Press [bold]Ctrl+C[/] to stop.",
        border_style="green",
    ))

    run_count = 0
    while True:
        run_count += 1
        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
        console.rule(f"[cyan]Run #{run_count}  —  {now}[/]")

        alerts = fetch_flow_alerts(limit=50)

        if alerts:
            show_table(
                "Options Flow Alerts",
                alerts,
                [
                    ("Ticker", "ticker"),
                    ("Type", "type"),
                    ("Strike", "strike"),
                    ("Expiry", "expiry"),
                    ("Premium", "total_premium"),
                    ("Vol/OI", "volume_oi_ratio"),
                    ("Rule", "alert_rule"),
                ],
                max_rows=15,
            )

            data_str = json.dumps(alerts[:40], indent=2, default=str)
            title = f"Flow Alert — Run #{run_count}"

            analysis = analyze_with_claude(
                system_prompt=(
                    "You are an expert options trader and institutional flow analyst. "
                    "Analyze the options flow and give a concise, actionable summary. "
                    "Focus on the most unusual or significant activity. Be brief — this is "
                    "a scheduled alert, not a full report. Aim for 300–500 words."
                ),
                user_content=(
                    f"Real-time unusual options flow from Unusual Whales ({now}):\n\n"
                    f"```json\n{data_str}\n```\n\n"
                    "Quick analysis:\n"
                    "**Top 3 Noteworthy Trades** — most significant or unusual\n"
                    "**Overall Bias** — bullish, bearish, or mixed and why\n"
                    "**Watch List** — tickers to monitor based on this flow\n"
                    "**Key Risk** — one thing to be aware of\n"
                ),
                title=title,
            )

            if use_discord and analysis:
                send_discord(title, analysis, "monitor")
        else:
            console.print("[red]No flow data returned this cycle.[/]")

        next_run = datetime.utcnow().strftime
        console.print(f"\n[dim]Next run in {interval_mins} minutes... (Ctrl+C to stop)[/]\n")
        try:
            time.sleep(interval_mins * 60)
        except KeyboardInterrupt:
            console.print("\n[bold yellow]Monitor stopped.[/]")
            break


# ── Entry Point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Unusual Whales + Claude AI Market Analysis Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
  flow              Real-time unusual options flow alerts + Claude analysis
  market            Sector ETFs, economic calendar, FDA events + briefing
  darkpool <TICK>   Dark pool block trades for a specific ticker
  stock <TICK>      Full deep-dive: options flow + dark pool for a ticker
  jortrade          JORTRADE: Top 3 defined-risk setups from whale flow
  signal            Entry signal check — returns ALERT or NO TRADE SIGNAL only
  monitor           Auto-run flow analysis every N minutes (set DISCORD_WEBHOOK_URL)

Add --discord to any command to post the analysis to your Discord channel.

Examples:
  python whale_claude.py flow
  python whale_claude.py flow --limit 100 --discord
  python whale_claude.py market --discord
  python whale_claude.py darkpool NVDA --discord
  python whale_claude.py stock TSLA --discord
  python whale_claude.py jortrade
  python whale_claude.py jortrade --discord
  python whale_claude.py signal
  python whale_claude.py signal --discord
  python whale_claude.py monitor
  python whale_claude.py monitor --interval 30
        """,
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    p_flow = subparsers.add_parser("flow", help="Analyze unusual options flow alerts")
    p_flow.add_argument("--limit", type=int, default=50, help="Number of alerts (default: 50)")
    p_flow.add_argument("--discord", action="store_true", help="Post analysis to Discord")

    p_market = subparsers.add_parser("market", help="Market overview: sectors, economic & FDA calendar")
    p_market.add_argument("--discord", action="store_true", help="Post analysis to Discord")

    p_dp = subparsers.add_parser("darkpool", help="Dark pool analysis for a specific ticker")
    p_dp.add_argument("ticker", type=str, help="Stock ticker (e.g. AAPL)")
    p_dp.add_argument("--limit", type=int, default=40, help="Number of transactions (default: 40)")
    p_dp.add_argument("--discord", action="store_true", help="Post analysis to Discord")

    p_stock = subparsers.add_parser("stock", help="Full stock deep-dive: flow + dark pool")
    p_stock.add_argument("ticker", type=str, help="Stock ticker (e.g. NVDA)")
    p_stock.add_argument("--limit", type=int, default=50, help="Flow alerts to scan (default: 50)")
    p_stock.add_argument("--discord", action="store_true", help="Post analysis to Discord")

    p_jt = subparsers.add_parser("jortrade", help="Top 3 defined-risk setups from whale flow (JORTRADE framework)")
    p_jt.add_argument("--discord", action="store_true", help="Post analysis to Discord")

    p_sig = subparsers.add_parser("signal", help="Entry signal check — returns ALERT or NO TRADE SIGNAL only")
    p_sig.add_argument("--discord", action="store_true", help="Post alert to Discord if signal fires")

    p_mon = subparsers.add_parser("monitor", help="Auto-run flow alerts on a schedule with Discord alerts")
    p_mon.add_argument("--interval", type=int, default=60, help="Minutes between runs (default: 60)")

    args = parser.parse_args()

    console.print(Panel(
        "[bold white]Unusual Whales + Claude AI[/]  [dim]Market Intelligence Tool[/]",
        border_style="blue",
        padding=(0, 2),
    ))

    dispatch = {
        "flow": cmd_flow,
        "market": cmd_market,
        "darkpool": cmd_darkpool,
        "stock": cmd_stock,
        "jortrade": cmd_jortrade,
        "signal": cmd_signal,
        "monitor": cmd_monitor,
    }
    dispatch[args.command](args)


if __name__ == "__main__":
    main()

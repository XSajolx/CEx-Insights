export const maxDuration = 60;

const INTERCOM_API = "https://api.intercom.io";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function intercomFetch(url, headers, options = {}) {
  const res = await fetch(url, { headers, ...options });
  if (res.status === 429) {
    await sleep(2000);
    return intercomFetch(url, headers, options);
  }
  if (!res.ok) throw new Error(`Intercom API ${res.status}: ${await res.text()}`);
  return res.json();
}

// Get just total_count from search (no pagination, per_page=1)
async function getConvCount(headers, query) {
  const data = await intercomFetch(`${INTERCOM_API}/conversations/search`, headers, {
    method: "POST",
    body: JSON.stringify({ query, pagination: { per_page: 1 } }),
  });
  return data.total_count || 0;
}

async function getTicketCount(headers, query) {
  const data = await intercomFetch(`${INTERCOM_API}/tickets/search`, headers, {
    method: "POST",
    body: JSON.stringify({ query, pagination: { per_page: 1 } }),
  });
  return data.total_count || data.tickets?.length || 0;
}

// Team IDs for CFD and Futures chat breakdown
const CFD_TEAM_IDS = [
  6522589,  // SC- GS (CFD)
  6577903,  // SM- FB & Insta (CFD)
  6657895,  // SC- PS (CFD)
  6741271,  // SC- PS- UN (CFD)
  8962688,  // SM- UN (CFD)
  9193872,  // PC- PS (CFD)
  9193877,  // PC- GS (CFD)
  9193895,  // PC- PS- UN (CFD)
  9198534,  // PC- GS- UN (CFD)
  9198555,  // SC- GS- UN (CFD)
  9897870,  // Transfer Chats (CFD)
];

const FUT_TEAM_IDS = [
  8103855,  // SC- GS (FUT)
  8103856,  // SC- PS (FUT)
  8273960,  // SC- GS- UN (FUT)
  9193853,  // PC- PS (FUT)
  9193856,  // PC- PS- UN (FUT)
  9193905,  // PC- GS (FUT)
  9193915,  // PC- GS- UN (FUT)
  9193921,  // SC- PS- UN (FUT)
  9868783,  // SM - FB & Insta (FUT)
  9868879,  // SM - UN (FUT)
  9897900,  // Transfer Chats (FUT)
];

function getDayName(dateStr) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const d = new Date(dateStr + "T00:00:00Z");
  return days[d.getUTCDay()];
}

// Handles a single date (YYYY-MM-DD). Uses search filters for exact counts.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const token = process.env.INTERCOM_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: "INTERCOM_ACCESS_TOKEN not configured" });

  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const dayStart = Math.floor(new Date(date + "T00:00:00+06:00").getTime() / 1000);
  // Use next day midnight for clean boundary (no gaps, no overlaps between days)
  const nextDay = new Date(date + "T00:00:00+06:00");
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStart = Math.floor(nextDay.getTime() / 1000);

  const dateRange = [
    { field: "created_at", operator: ">=", value: dayStart },
    { field: "created_at", operator: "<", value: nextDayStart },
  ];

  try {
    // All queries use search filters → exact total_count, 1 API call each
    // Run all in parallel for speed
    const custInit = { field: "source.delivered_as", operator: "=", value: "customer_initiated" };
    const [chat, email, facebook, instagram, finTotal, ticket] = await Promise.all([
      // Chat: source.type=conversation + customer_initiated (matches Intercom's Chat channel)
      getConvCount(headers, {
        operator: "AND",
        value: [...dateRange, { field: "source.type", operator: "=", value: "conversation" }, custInit],
      }),
      // Email: source.type=email + has contact reply (matches Intercom's Email channel)
      getConvCount(headers, {
        operator: "AND",
        value: [...dateRange, { field: "source.type", operator: "=", value: "email" },
          { field: "statistics.last_contact_reply_at", operator: ">", value: 0 }],
      }),
      // Facebook: + customer_initiated
      getConvCount(headers, {
        operator: "AND",
        value: [...dateRange, { field: "source.type", operator: "=", value: "facebook" }, custInit],
      }),
      // Instagram: + customer_initiated
      getConvCount(headers, {
        operator: "AND",
        value: [...dateRange, { field: "source.type", operator: "=", value: "instagram" }, custInit],
      }),
      // FIN AI participated (all conversations where FIN was involved)
      getConvCount(headers, {
        operator: "AND",
        value: [...dateRange, { field: "ai_agent_participated", operator: "=", value: true }],
      }),
      // Tickets (same boundary as conversations)
      getTicketCount(headers, {
        operator: "AND",
        value: [
          { field: "created_at", operator: ">=", value: dayStart },
          { field: "created_at", operator: "<", value: nextDayStart },
        ],
      }),
    ]);

    // Second parallel batch: FIN breakdown + CFD/FUT team counts
    const cfdTeamFilter = { operator: "OR", value: CFD_TEAM_IDS.map(id => ({ field: "team_assignee_id", operator: "=", value: id })) };
    const futTeamFilter = { operator: "OR", value: FUT_TEAM_IDS.map(id => ({ field: "team_assignee_id", operator: "=", value: id })) };

    const [finWithHuman, cfd, fut] = await Promise.all([
      // FIN with human admin reply
      getConvCount(headers, {
        operator: "AND",
        value: [
          ...dateRange,
          { field: "ai_agent_participated", operator: "=", value: true },
          { field: "statistics.first_admin_reply_at", operator: ">", value: 0 },
        ],
      }),
      // CFD team chats
      getConvCount(headers, {
        operator: "AND",
        value: [...dateRange, cfdTeamFilter],
      }),
      // FUT team chats
      getConvCount(headers, {
        operator: "AND",
        value: [...dateRange, futTeamFilter],
      }),
    ]);
    const finResolved = finTotal - finWithHuman;

    // Live Chat = conversation + facebook + instagram (matches Intercom's channel definition)
    const liveChat = chat + facebook + instagram;

    return res.status(200).json({
      date,
      day: getDayName(date),
      chat: liveChat,       // conversation + facebook + instagram (matches Intercom)
      email,                // email (matches Intercom)
      fin: finResolved,     // FIN-only, no human agent (separate section)
      ticket,
      cfd,                  // CFD team assigned chats
      fut,                  // Futures team assigned chats
      total_conversations: liveChat + email,  // matches Intercom's channel total
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

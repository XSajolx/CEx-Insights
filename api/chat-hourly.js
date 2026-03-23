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

async function getConvCount(headers, query) {
  const data = await intercomFetch(`${INTERCOM_API}/conversations/search`, headers, {
    method: "POST",
    body: JSON.stringify({ query, pagination: { per_page: 1 } }),
  });
  return data.total_count || 0;
}

const CFD_TEAM_IDS = [
  6522589, 6577903, 6657895, 6741271, 8962688,
  9193872, 9193877, 9193895, 9198534, 9198555, 9897870,
];

const FUT_TEAM_IDS = [
  8103855, 8103856, 8273960, 9193853, 9193856,
  9193905, 9193915, 9193921, 9868783, 9868879, 9897900,
];

function getDayName(dateStr) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const d = new Date(dateStr + "T00:00:00Z");
  return days[d.getUTCDay()];
}

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

  const custInit = { field: "source.delivered_as", operator: "=", value: "customer_initiated" };
  const cfdTeamFilter = { operator: "OR", value: CFD_TEAM_IDS.map(id => ({ field: "team_assignee_id", operator: "=", value: id })) };
  const futTeamFilter = { operator: "OR", value: FUT_TEAM_IDS.map(id => ({ field: "team_assignee_id", operator: "=", value: id })) };

  try {
    const baseTs = Math.floor(new Date(date + "T00:00:00+06:00").getTime() / 1000);

    // For each hour, query: overall chat, CFD, FUT — 3 queries × 24 hours = 72 parallel
    const promises = [];
    for (let h = 0; h < 24; h++) {
      const hStart = baseTs + h * 3600;
      const hEnd = hStart + 3600;
      const range = [
        { field: "created_at", operator: ">=", value: hStart },
        { field: "created_at", operator: "<", value: hEnd },
      ];

      // Overall chats (customer_initiated)
      promises.push(
        getConvCount(headers, { operator: "AND", value: [...range, custInit] })
      );
      // CFD
      promises.push(
        getConvCount(headers, { operator: "AND", value: [...range, cfdTeamFilter] })
      );
      // FUT
      promises.push(
        getConvCount(headers, { operator: "AND", value: [...range, futTeamFilter] })
      );
    }

    const results = await Promise.all(promises);

    const hours = [];
    const cfd_hours = [];
    const fut_hours = [];
    for (let h = 0; h < 24; h++) {
      hours.push(results[h * 3]);
      cfd_hours.push(results[h * 3 + 1]);
      fut_hours.push(results[h * 3 + 2]);
    }

    return res.status(200).json({
      date,
      day: getDayName(date),
      hours,       // overall chat per hour
      cfd_hours,   // CFD per hour
      fut_hours,   // FUT per hour
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

import fetch from "node-fetch";
import { writeFileSync } from "fs";
import { JSDOM } from "jsdom";

const URL = "https://nukaknights.com/en/";
const INVENTORY_URL = "https://nukaknights.com/minerva-dates-inventory.html";
const WHERE_URL = "https://whereisminerva.nukaknights.com/";
const DEBUG = process.env.MINERVA_DEBUG === "1";

// Restrict parsing to the requested list segment so old rotations do not leak in.
function extractItemsForList(text, listNumber) {
  const markerRegex = /Minerva\s*\(List\s*(\d+)[^)]*\)|List\s+(\d+)/gi;
  const markers = [];
  let match;
  while ((match = markerRegex.exec(text)) !== null) {
    const num = parseInt(match[1] || match[2], 10);
    if (!Number.isNaN(num)) {
      markers.push({ num, start: match.index });
    }
  }

  if (DEBUG) {
    console.log(`DEBUG markers (${markers.length}):`, markers.map(m => m.num).join(", "));
  }

  const planItemRegex = /Plan:\s+(.+?)\s*([\d,]+)\s+Gold/gi;
  let best = [];

  for (let i = 0; i < markers.length; i++) {
    if (markers[i].num !== listNumber) continue;

    const start = markers[i].start;
    const end = i + 1 < markers.length ? markers[i + 1].start : text.length;
    const segment = text.slice(start, end);

    const found = [];
    while ((match = planItemRegex.exec(segment)) !== null) {
      const pretty = `Plan: ${match[1].trim()} ${match[2]} Gold`;
      if (!found.includes(pretty)) found.push(pretty);
    }

    if (DEBUG) {
      const preview = segment.replace(/\s+/g, " ").slice(0, 300);
      console.log(`DEBUG segment list ${listNumber} (items ${found.length}):`, preview);
    }

    if (found.length > best.length) {
      best = found;
    }
  }

  if (!best.length && DEBUG) {
    console.log(`DEBUG: no items found for list ${listNumber}`);
  }

  return best;
}

async function scrapeMinerva() {
  // Hent hovedsiden for datoer og lokation
  const res = await fetch(URL);
  const html = await res.text();
  const dom = new JSDOM(html);
  
  const bodyText = dom.window.document.documentElement.textContent || html;
  
  // Find "Fallout 76 Minerva Dates:" sektionen
  const minervaStartIndex = bodyText.indexOf("Fallout 76 Minerva Dates:");
  
  if (minervaStartIndex === -1) {
    throw new Error("Minerva data ikke fundet på siden");
  }

  const minervaText = bodyText.substring(minervaStartIndex);
  const lines = minervaText.split("\n").map(l => l.trim()).filter(l => l);
  
  let eventLine = null;
  let eventIndex = -1;
  let listNumber = null;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("Minerva") && (lines[i].includes("List") || lines[i].includes("Big Sale"))) {
      eventLine = lines[i];
      eventIndex = i;
      
      // Extract list number
      const listMatch = lines[i].match(/List\s+(\d+)/);
      if (listMatch) {
        listNumber = parseInt(listMatch[1]);
      }
      break;
    }
  }

  if (!eventLine) {
    throw new Error("Minerva event ikke fundet");
  }

  // Find lokation (næste linje med "Location:")
  const locationLine = lines[eventIndex + 1] || "";
  // Nogle gange står datoerne på samme linje som "Location:".
  // Klip alt efter første ugedagsforkortelse (Mo, Tu, We, Th, Fr, Sa, Su)
  const afterLocation = locationLine.replace("Location:", "").trim();
  const dayIdxMatch = afterLocation.match(/\b(Mo|Tu|We|Th|Fr|Sa|Su),/);
  const location = (dayIdxMatch
    ? afterLocation.slice(0, afterLocation.indexOf(dayIdxMatch[0]))
    : afterLocation
  ).trim();

  // Find datoerne
  let from = "";
  let to = "";
  let dateLineIndex = -1;
  
  // Find datoerne robust: søg i et vindue på 8 linjer omkring eventen
  const windowText = lines.slice(eventIndex, Math.min(eventIndex + 8, lines.length)).join(" ");
  // Eksempel: "Mo, 15th Dec 2025 (12:00) - We, 17th Dec 2025 (12:00)"
  const dateRangeRegex = /([A-Za-z]{2,3},?\s*\d{1,2}\w{0,2}\s+[A-Za-z]{3,9}\s+\d{4}\s*\(\s*\d{1,2}:\d{2}\s*\))\s*-\s*([A-Za-z]{2,3},?\s*\d{1,2}\w{0,2}\s+[A-Za-z]{3,9}\s+\d{4}\s*\(\s*\d{1,2}:\d{2}\s*\))/;
  const dr = windowText.match(dateRangeRegex);
  if (dr) {
    from = dr[1].replace(/\s+/g, " ").trim();
    to = dr[2].replace(/\s+/g, " ").trim();
    // find en linje i vinduet at markere som dateLineIndex til item-parsingen nedenfor
    for (let i = eventIndex; i < Math.min(eventIndex + 8, lines.length); i++) {
      if (lines[i] && lines[i].includes(dr[1].split(" (")[0])) { dateLineIndex = i; break; }
    }
  } else {
    // Fallback: forsøg linje-for-linje match
    for (let i = eventIndex + 1; i < Math.min(eventIndex + 8, lines.length); i++) {
      const m = lines[i].match(dateRangeRegex);
      if (m) {
        from = m[1].replace(/\s+/g, " ").trim();
        to = m[2].replace(/\s+/g, " ").trim();
        dateLineIndex = i;
        break;
      }
    }
  }

  // Hent inventory-siden for items
  let items = [];
  try {
    const invRes = await fetch(INVENTORY_URL);
    const invHtml = await invRes.text();
    const invDom = new JSDOM(invHtml);
    
    const invText = invDom.window.document.documentElement.textContent || invHtml;
    
    if (listNumber) {
      items = extractItemsForList(invText, listNumber);

      // Fallback: forsøg whereisminerva, men stadig kun inden for den specifikke liste
      if (items.length === 0) {
        try {
          const whereRes = await fetch(WHERE_URL);
          const whereHtml = await whereRes.text();
          const whereDom = new JSDOM(whereHtml);
          const whereText = whereDom.window.document.documentElement.textContent || whereHtml;
          items = extractItemsForList(whereText, listNumber);
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn("⚠️ Kunne ikke hente items fra inventory-siden:", err.message);
  }

  const data = {
    location,
    event: eventLine,
    list: listNumber,
    from,
    to,
    itemCount: items.length,
    items: items,
    source: "nukaknights.com",
    lastUpdated: new Date().toISOString()
  };

  writeFileSync("minerva.json", JSON.stringify(data, null, 2));
  console.log("✓ minerva.json opdateret");
  console.log(`  Lokation: ${location}`);
  console.log(`  Event: ${eventLine}`);
  console.log(`  Liste: ${listNumber}`);
  console.log(`  Fra: ${from}`);
  console.log(`  Til: ${to}`);
  console.log(`  Items: ${items.length}`);
}

scrapeMinerva().catch(err => {
  console.error("❌ Fejl:", err.message);
  process.exit(1);
});

import fetch from "node-fetch";
import { writeFileSync } from "fs";
import { JSDOM } from "jsdom";

const URL = "https://nukaknights.com/en/";
const INVENTORY_URL = "https://nukaknights.com/minerva-dates-inventory.html";
const WHERE_URL = "https://whereisminerva.nukaknights.com/";

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
  
  // Find den første Minerva liste
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
  let from = "", to = "";
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
      const planItemRegex = /Plan:\s+(.+?)\s+(\d+)\s+Gold/gi;

      // 1) Forsøg "Minerva (List N)"-sektionen
      let segmentRegex = new RegExp(`Minerva\s*\(List\s*${listNumber}\)[\\s\\S]*?(?=Minerva\s*\\(List\\s*\\d+\\)|$)`, 'i');
      let segmentMatch = invText.match(segmentRegex);
      if (segmentMatch) {
        let m;
        while ((m = planItemRegex.exec(segmentMatch[0])) !== null) {
          const pretty = `Plan: ${m[1].trim()} ${m[2]} Gold`;
          if (!items.includes(pretty)) items.push(pretty);
        }
      }

      // 2) Hvis ingen items: fallback til "List N" (datamining) sektionen
      if (items.length === 0) {
        const listRegex = new RegExp(`List\\s+${listNumber}[\\s\\S]*?(?=List\\s+\\d+|$)`, 'i');
        const listMatch = invText.match(listRegex);
        if (listMatch) {
          let m;
          while ((m = planItemRegex.exec(listMatch[0])) !== null) {
            const pretty = `Plan: ${m[1].trim()} ${m[2]} Gold`;
            if (!items.includes(pretty)) items.push(pretty);
          }
        }
      }

      // 3) Sidste udvej: scan hele siden
      if (items.length === 0) {
        let m;
        while ((m = planItemRegex.exec(invText)) !== null) {
          const pretty = `Plan: ${m[1].trim()} ${m[2]} Gold`;
          if (!items.includes(pretty)) items.push(pretty);
        }
      }

      // 4) Ekstra fallback: brug whereisminerva-siden
      if (items.length === 0) {
        try {
          const whereRes = await fetch(WHERE_URL);
          const whereHtml = await whereRes.text();
          const whereDom = new JSDOM(whereHtml);
          const whereText = whereDom.window.document.documentElement.textContent || whereHtml;
          // Minerva (List N) sektion
          const seg = whereText.match(new RegExp(`Minerva\\s*\\(List\\s*${listNumber}\\)[\\s\\S]*?(?=Minerva\\s*\\(List\\s*\\d+\\)|$)`, 'i'));
          if (seg) {
            let m;
            while ((m = planItemRegex.exec(seg[0])) !== null) {
              const pretty = `Plan: ${m[1].trim()} ${m[2]} Gold`;
              if (!items.includes(pretty)) items.push(pretty);
            }
            // 4b) Hvis regex stadig ikke fanger noget, split manuelt på "Plan:" og klip frem til "Gold"
            if (items.length === 0 && seg[0].includes('Plan:')) {
              const cleaned = seg[0].replace(/\s+/g, ' ').trim();
              const chunks = cleaned.split(/Plan:\s*/).slice(1);
              for (const ch of chunks) {
                const end = ch.indexOf(' Gold');
                if (end > 0) {
                  const token = ch.slice(0, end + ' Gold'.length);
                  const pretty = `Plan: ${token}`.trim();
                  if (!items.includes(pretty)) items.push(pretty);
                }
              }
            }
          }
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

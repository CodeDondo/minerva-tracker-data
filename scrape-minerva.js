import fetch from "node-fetch";
import { writeFileSync } from "fs";
import { JSDOM } from "jsdom";

const URL = "https://nukaknights.com/en/";

async function scrapeMinerva() {
  const res = await fetch(URL);
  const html = await res.text();
  const dom = new JSDOM(html);
  const document = dom.window.document;

  /**
   * Parse Minerva data fra HTML-tekst
   * Henter lokation, datoer og alle items
   */
  
  const bodyText = document.documentElement.textContent || html;
  
  // Find "Fallout 76 Minerva Dates:" sektionen
  const minervaStartIndex = bodyText.indexOf("Fallout 76 Minerva Dates:");
  
  if (minervaStartIndex === -1) {
    throw new Error("Minerva data ikke fundet på siden");
  }

  // Tag teksten fra Minerva-sektionen
  const minervaText = bodyText.substring(minervaStartIndex);
  
  // Split efter linjeskift
  const lines = minervaText.split("\n").map(l => l.trim()).filter(l => l);
  
  // Find den første Minerva liste
  let eventLine = null;
  let eventIndex = -1;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("Minerva") && (lines[i].includes("List") || lines[i].includes("Big Sale"))) {
      eventLine = lines[i];
      eventIndex = i;
      break;
    }
  }

  if (!eventLine) {
    throw new Error("Minerva event ikke fundet");
  }

  // Find lokation (næste linje med "Location:")
  const locationLine = lines[eventIndex + 1] || "";
  const location = locationLine.replace("Location:", "").trim().split(/[\n,]/)[0].trim();

  // Find datoerne
  let from = "", to = "";
  let dateLineIndex = -1;
  
  for (let i = eventIndex + 1; i < Math.min(eventIndex + 5, lines.length); i++) {
    if (lines[i].match(/\d+\w+\s+\w+\s+\d{4}/)) {
      const dateMatch = lines[i].match(/(\w+,?\s+\d+\w+\s+\w+\s+\d{4}[^\d]*\d{2}:\d{2})\s*-\s*(\w+,?\s+\d+\w+\s+\w+\s+\d{4}[^\d]*\d{2}:\d{2})/);
      if (dateMatch) {
        from = dateMatch[1].replace(/\s+/g, " ").trim();
        to = dateMatch[2].replace(/\s+/g, " ").trim();
        dateLineIndex = i;
        break;
      }
    }
  }

  // Parse items/plans efter datoen
  const items = [];
  
  if (dateLineIndex !== -1) {
    for (let i = dateLineIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      
      // Stop hvis vi rammer næste event
      if (line.match(/^(Minerva|Holiday|Double|Treasure)/i)) {
        break;
      }
      
      // Samle items som indeholder "Plan:" eller end med "Gold"
      if (line.includes("Plan:") || line.match(/\d+\s+Gold\s*$/i)) {
        items.push(line);
      }
    }
  }

  const data = {
    location,
    event: eventLine,
    from,
    to,
    itemCount: items.length,
    items: items.slice(0, 50), // Begræns til første 50 items
    source: "nukaknights.com",
    lastUpdated: new Date().toISOString()
  };

  writeFileSync("minerva.json", JSON.stringify(data, null, 2));
  console.log("✓ minerva.json opdateret");
  console.log(`  Lokation: ${location}`);
  console.log(`  Event: ${eventLine}`);
  console.log(`  Fra: ${from}`);
  console.log(`  Til: ${to}`);
  console.log(`  Items: ${items.length}`);
}

scrapeMinerva().catch(err => {
  console.error("❌ Fejl:", err.message);
  process.exit(1);
});

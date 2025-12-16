import fetch from "node-fetch";
import { writeFileSync } from "fs";
import { JSDOM } from "jsdom";

const URL = "https://nukaknights.com/en/";
const INVENTORY_URL = "https://nukaknights.com/minerva-dates-inventory.html";

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

  // Find lokation
  const locationLine = lines[eventIndex + 1] || "";
  const location = locationLine.replace("Location:", "").trim().split(/[\n,]/)[0].trim();

  // Find datoerne
  let from = "", to = "";
  
  for (let i = eventIndex + 1; i < Math.min(eventIndex + 5, lines.length); i++) {
    if (lines[i].match(/\d+\w+\s+\w+\s+\d{4}/)) {
      const dateMatch = lines[i].match(/(\w+,?\s+\d+\w+\s+\w+\s+\d{4}[^\d]*\d{2}:\d{2})\s*-\s*(\w+,?\s+\d+\w+\s+\w+\s+\d{4}[^\d]*\d{2}:\d{2})/);
      if (dateMatch) {
        from = dateMatch[1].replace(/\s+/g, " ").trim();
        to = dateMatch[2].replace(/\s+/g, " ").trim();
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
      // Find "List X" sektionen
      const listRegex = new RegExp(`List\\s+${listNumber}[^]*?(?=List\\s+\\d+|$)`, 'i');
      const listMatch = invText.match(listRegex);
      
      if (listMatch) {
        const listContent = listMatch[0];
        // Find alle "Plan: ... Gold" linier
        const planRegex = /Plan:\s+[^]*?(\d+)\s+Gold/gi;
        let planMatch;
        
        while ((planMatch = planRegex.exec(listContent)) !== null) {
          // Get the full line
          const startIndex = listContent.lastIndexOf('\n', planMatch.index) + 1;
          const endIndex = listContent.indexOf('\n', planMatch.index);
          const fullLine = listContent.substring(startIndex, endIndex === -1 ? undefined : endIndex).trim();
          
          if (fullLine && !items.includes(fullLine)) {
            items.push(fullLine);
          }
        }
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

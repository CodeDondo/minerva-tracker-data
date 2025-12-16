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
   * ⚠️ Disse selectors skal opdateres baseret på nukaknights.com struktur
   * Nukaknights ændrer sjældent markup, men tjek altid selv
   */
  
  // Forsøg forskellige selektorer
  const location = document
    .querySelector("h1, h2, .location, [data-location]")
    ?.textContent.trim() || document.body.innerText.split('\n')[0];

  const event = document
    .querySelector(".event, [data-event], .title")
    ?.textContent.trim() || "Minerva Event";

  const dates = document
    .querySelector(".dates, [data-dates], .date-range")
    ?.textContent.trim() || new Date().toISOString().split('T')[0];

  if (!location) {
    throw new Error("Minerva data ikke fundet – selector matcher ikke");
  }

  const [from, to] = dates?.split("–").map(d => d.trim()) || [];

  const data = {
    location,
    event,
    from,
    to,
    source: "nukaknights.com",
    lastUpdated: new Date().toISOString()
  };

  writeFileSync("minerva.json", JSON.stringify(data, null, 2));
  console.log("minerva.json opdateret");
}

scrapeMinerva();

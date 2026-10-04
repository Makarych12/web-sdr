import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const c = await browser.newContext();
const p = await c.newPage();
try {
  await p.goto(process.env.TEST_APP_URL || "http://localhost:8787");
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload();
  assert.ok(
    await p.evaluate(() => navigator.serviceWorker.controller !== null),
  );
  const manifest = await p.evaluate(async () => {
    const m = await (await fetch("/manifest.webmanifest")).json();
    for (const i of m.icons) {
      const r = await fetch(i.src);
      if (!r.ok) throw Error("Missing PWA icon");
    }
    return m;
  });
  assert.equal(manifest.display, "standalone");
  await c.setOffline(true);
  await p.reload();
  await p.getByRole("heading", { name: "UR4MTN", exact: true }).waitFor();
  assert.ok(await p.getByRole("button", { name: "Слушать эфир" }).isDisabled());
  console.log(
    "PASS: service worker controls page, manifest/icons load, cached app opens offline",
  );
} finally {
  await browser.close();
}

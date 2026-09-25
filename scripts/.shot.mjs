import puppeteer from "puppeteer-core";
const [,, out, w] = process.argv;
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: +w, height: 120 });
await p.goto("http://localhost:4400/nosotros", { waitUntil: "networkidle0" });
await p.screenshot({ path: out });
await b.close();

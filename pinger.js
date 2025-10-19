// pinger.js
const URL = "https://scrims-bot12.onrender.com"; // 👈 change this to your Render web URL

async function ping() {
  try {
    const res = await fetch(URL);
    const text = await res.text();
    console.log(`[PINGER] Pinged ${URL}: ${res.status}`);
  } catch (err) {
    console.error("[PINGER] Failed:", err.message);
  }
}

// run now, then every 5 minutes
ping();
setInterval(ping, 5 * 60 * 1000);

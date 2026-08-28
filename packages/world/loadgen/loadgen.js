// Steady background traffic so dashboards are alive: ~4 rps against /checkout.
const API = process.env.API_URL || 'http://api:7401';
async function tick() {
  try {
    await fetch(`${API}/checkout`, { method: 'POST', signal: AbortSignal.timeout(5000) });
  } catch {
    /* failures are the point sometimes */
  }
}
setInterval(tick, 250);
console.log('loadgen: ~4 rps against', API);

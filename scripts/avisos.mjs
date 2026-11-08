// Envía cada mañana un aviso al móvil con los cobros y plazos de cada usuario.
// Los registros de GitHub son públicos: aquí solo se escriben números, nunca datos personales.
import admin from "firebase-admin";

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error("Falta el secreto FIREBASE_SERVICE_ACCOUNT."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
const fs = admin.firestore(), msg = admin.messaging();
const TEST = process.env.PRUEBA === "true";

const DAY = 86400000;
const [Y, M, D] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" })
  .format(new Date()).split("-").map(Number);
const today = new Date(Date.UTC(Y, M - 1, D));
const iso = d => d.toISOString().slice(0, 10), ym = d => iso(d).slice(0, 7);
const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const diff = d => Math.round((d - today) / DAY);
const eur = n => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);
const fecha = d => new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" }).format(d).replace(".", "");
const nthWd = (y, mo, n, wd) => {
  const first = 1 + ((wd - new Date(Date.UTC(y, mo, 1)).getUTCDay() + 7) % 7), last = dim(y, mo);
  if (n === -1) { let d = first; while (d + 7 <= last) d += 7; return new Date(Date.UTC(y, mo, d)); }
  return new Date(Date.UTC(y, mo, first + (n - 1) * 7));
};
function payDates(st, y, mo) {
  const md = st.payMode || "nsemana", wd = st.payWd == null || st.payWd === "" ? 6 : Number(st.payWd), pl = st.payPlan || [], out = [];
  if (md === "semanal") { const a = (pl[0] || {}).amount || 0; if (a) { let d = nthWd(y, mo, 1, wd); while (d.getUTCMonth() === mo) { out.push({ date: d, amount: a }); d = new Date(d.getTime() + 7 * DAY); } } }
  else if (md === "nsemana") pl.filter(p => p.n).forEach(p => out.push({ date: nthWd(y, mo, Number(p.n), wd), amount: p.amount || 0 }));
  else pl.filter(p => p.day).forEach(p => out.push({ date: new Date(Date.UTC(y, mo, Math.min(Number(p.day), dim(y, mo)))), amount: p.amount || 0 }));
  return out;
}

async function linesFor(u) {
  const [setS, recS, upS] = await Promise.all([u.collection("settings").doc("main").get(), u.collection("recurring").get(), u.collection("upcoming").get()]);
  const st = setS.exists ? setS.data() : {}, lines = [];
  if (TEST) lines.push("Prueba: los avisos funcionan ✅");

  for (const r of recS.docs.map(d => d.data())) {
    if (r.type !== "cobro" || r.active === false || !r.day) continue;
    for (const k of [0, 1]) {
      const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + k, 1)), key = ym(base);
      if (r.start && key < r.start) continue;
      if ((r.paid || []).includes(key)) continue;
      const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), Math.min(r.day, dim(base.getUTCFullYear(), base.getUTCMonth()))));
      const n = diff(d), amt = eur(r.amount || 0);
      if (n === 1) lines.push(`Mañana se cobra ${r.name}: ${amt}. Revisa que tengas saldo.`);
      else if (n === 0) lines.push(`Hoy se cobra ${r.name}: ${amt}.`);
      else if (k === 0 && n < 0 && n >= -5) lines.push(`Sin marcar como pagado: ${r.name} (día ${r.day}). Si ya se cobró, márcalo.`);
    }
  }

  for (const p of payDates(st, today.getUTCFullYear(), today.getUTCMonth()))
    if (diff(p.date) === 0 && p.amount) lines.push(`Hoy cobras ${eur(p.amount)}. Anótalo en Ingresos cuando te llegue.`);

  for (const x of upS.docs.map(d => d.data())) {
    if (x.done || !x.date) continue;
    const [a, b, c] = x.date.split("-").map(Number), d = new Date(Date.UTC(a, b - 1, c)), n = diff(d);
    if (![14, 7, 3, 1, 0].includes(n)) continue;
    const when = n === 0 ? "vence hoy" : n === 1 ? "vence mañana" : `en ${n} días`;
    lines.push(`${x.task ? "Tarea" : "Gasto previsto"}: ${x.name}, ${when} (${fecha(d)})${x.amount ? " · " + eur(x.amount) : ""}.`);
  }
  return lines;
}

let users = 0, sent = 0, removed = 0;
for (const u of await fs.collection("users").listDocuments()) {
  const toks = await u.collection("tokens").get();
  if (toks.empty) continue;
  users++;
  const lines = await linesFor(u);
  if (!lines.length) continue;
  const title = lines.length === 1 ? "Mi Plan Financiero" : `Mi Plan Financiero · ${lines.length} avisos`;
  const body = lines.slice(0, 6).join("\n") + (lines.length > 6 ? `\n…y ${lines.length - 6} más en la app.` : "");
  for (const t of toks.docs) {
    try {
      await msg.send({ token: t.id, data: { title, body, url: "./", tag: "avisos-" + iso(today) }, webpush: { headers: { Urgency: "high", TTL: "43200" } } });
      sent++;
    } catch (e) {
      if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"].includes(e.code)) { await t.ref.delete(); removed++; }
      else console.error("Error al enviar:", e.code || e.message);
    }
  }
}
console.log(`Fecha ${iso(today)} · usuarios con avisos: ${users} · enviados: ${sent} · dispositivos dados de baja: ${removed}`);

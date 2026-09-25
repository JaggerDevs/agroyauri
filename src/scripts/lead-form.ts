// Envío de leads: validación en el navegador + POST a /api/lead (valida de nuevo en servidor).
type Attr = Partial<Record<"landing_page" | "referrer" | "utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term" | "gclid" | "fbclid", string>>;

declare global {
  interface Window { turnstile?: { render: (el: Element, o: Record<string, unknown>) => string; reset: (id?: string) => void } }
}

function attribution(): Attr {
  try { return JSON.parse(sessionStorage.getItem("ay_attr") || "{}"); } catch { return {}; }
}

let turnstileLoading: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (!turnstileLoading) {
    turnstileLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("turnstile"));
      document.head.appendChild(s);
    });
  }
  return turnstileLoading;
}

function setup(form: HTMLFormElement) {
  const status = form.querySelector<HTMLElement>(".form-status")!;
  const submitBtn = form.querySelector<HTMLButtonElement>('[data-send="form"]')!;
  const waBtn = form.querySelector<HTMLButtonElement>('[data-send="whatsapp"]')!;
  const label = submitBtn.querySelector<HTMLElement>(".btn-label")!;
  const startedAt = Date.now();
  const siteKey = form.dataset.turnstile;
  let token = "";

  // Turnstile (opcional): se carga solo cuando el usuario empieza a escribir.
  if (siteKey) {
    form.addEventListener("focusin", () => {
      loadTurnstile()
        .then(() => {
          const slot = form.querySelector(".ts-slot");
          if (slot && !slot.childElementCount && window.turnstile) {
            window.turnstile.render(slot, { sitekey: siteKey, size: "flexible", callback: (t: string) => (token = t), "expired-callback": () => (token = "") });
          }
        })
        .catch(() => {});
    }, { once: true });
  }

  const setStatus = (msg: string, kind: "ok" | "err" | "") => {
    status.textContent = msg;
    status.className = `form-status ${kind}`;
  };

  const fields = () => Array.from(form.elements).filter((el): el is HTMLInputElement => "name" in el && !!(el as HTMLInputElement).name && (el as HTMLInputElement).name !== "website");

  function validate(): boolean {
    let ok = true;
    for (const el of fields()) {
      if (typeof el.value === "string" && el.type !== "number") el.value = el.value.trimStart();
      const bad = !el.checkValidity();
      el.classList.toggle("invalid", bad);
      el.setAttribute("aria-invalid", String(bad));
      if (bad) ok = false;
    }
    if (!ok) {
      setStatus("Por favor completa los campos obligatorios (*) correctamente.", "err");
      form.querySelector<HTMLElement>(".invalid")?.focus();
    }
    return ok;
  }

  function payload(channel: "form" | "whatsapp" = "form") {
    const f = form.elements as unknown as Record<string, HTMLInputElement>;
    const sel = form.querySelector<HTMLSelectElement>('select[name="service"]')!;
    const opt = sel.selectedOptions[0];
    const a = attribution();
    return {
      name: f.name.value.trim(),
      phone: f.phone.value.trim(),
      service_id: sel.value,
      service_label: opt?.dataset.label ?? "",
      message: f.message.value.trim(),
      landing_page: a.landing_page || location.pathname,
      page: location.pathname,
      referrer: a.referrer || "",
      utm_source: a.utm_source || "",
      utm_medium: a.utm_medium || "",
      utm_campaign: a.utm_campaign || "",
      utm_content: a.utm_content || "",
      utm_term: a.utm_term || "",
      gclid: a.gclid || "",
      fbclid: a.fbclid || "",
      channel,
      website: (form.elements.namedItem("website") as HTMLInputElement).value,
      elapsed_ms: Date.now() - startedAt,
      turnstile_token: token,
    };
  }

  async function send(channel: "form" | "whatsapp" = "form", keepalive = false): Promise<boolean> {
    const res = await fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload(channel)),
      keepalive,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No pudimos enviar tu solicitud.");
    return true;
  }

  form.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.classList.contains("invalid") && t.checkValidity()) {
      t.classList.remove("invalid");
      t.setAttribute("aria-invalid", "false");
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate()) return;
    if (siteKey && !token) {
      setStatus("Espera un momento: estamos verificando que no eres un robot…", "");
      return;
    }
    submitBtn.disabled = true;
    label.textContent = "Enviando…";
    setStatus("", "");
    try {
      await send();
      form.reset();
      setStatus("¡Gracias! Recibimos tu solicitud. Te contactaremos a la brevedad.", "ok");
      window.gtag?.("event", "generate_lead", { method: "form" });
    } catch (err) {
      setStatus(`${(err as Error).message} También puedes escribirnos por WhatsApp.`, "err");
    } finally {
      submitBtn.disabled = false;
      label.textContent = "Enviar formulario";
      if (siteKey) { token = ""; window.turnstile?.reset(); }
    }
  });

  waBtn.addEventListener("click", () => {
    if (!validate()) return;
    const p = payload();
    const lines = [
      "Hola AGROYAURI SAC, quisiera solicitar una cotización:",
      "",
      `• Nombre: ${p.name}`,
      `• Teléfono: ${p.phone}`,
      `• Servicio: ${p.service_label}`,
      p.message && `• Mensaje: ${p.message}`,
    ].filter(Boolean);
    // Se abre de inmediato (evita bloqueadores de ventanas); el lead se registra en segundo plano.
    window.open(`https://wa.me/${form.dataset.wa}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank", "noopener");
    if (!siteKey || token) send("whatsapp", true).catch(() => {});
    setStatus("Abrimos WhatsApp con tu solicitud. ¡Gracias por escribirnos!", "ok");
    window.gtag?.("event", "generate_lead", { method: "whatsapp" });
  });
}

export function initLeadForms() {
  document.querySelectorAll<HTMLFormElement>("form.lead-form").forEach((f) => {
    if (f.dataset.ready) return;
    f.dataset.ready = "1";
    setup(f);
  });
}

declare global { interface Window { gtag?: (...args: unknown[]) => void } }

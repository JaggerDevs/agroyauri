(function () {
  "use strict";

  var WA_NUMBER = "51931637047";
  var EMAIL = "eyauri@agroyauri.com";

  /* ---------- Menú móvil ---------- */
  var toggle = document.getElementById("menuToggle");
  var nav = document.getElementById("mainNav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---------- Header fijo al hacer scroll ---------- */
  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-fixed", window.scrollY > 140);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Carrusel de proyectos ---------- */
  document.querySelectorAll("[data-carousel]").forEach(function (car) {
    var track = car.querySelector(".car-track");
    var prev = car.querySelector(".prev");
    var next = car.querySelector(".next");
    if (!track) return;
    var update = function () {
      var max = track.scrollWidth - track.clientWidth - 2;
      if (prev) prev.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft >= max;
    };
    car.querySelectorAll(".car-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var card = track.querySelector(".project-card");
        var step = card ? card.getBoundingClientRect().width + 16 : track.clientWidth;
        track.scrollBy({ left: step * Number(btn.dataset.dir), behavior: "smooth" });
      });
    });
    track.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  });

  /* ---------- Formulario de cotización ---------- */
  var form = document.getElementById("quoteForm");
  if (!form) return;
  var status = document.getElementById("formStatus");

  // "Seleccionar plan" preselecciona el plan en el formulario
  document.querySelectorAll("[data-plan]").forEach(function (a) {
    a.addEventListener("click", function () {
      form.elements.servicio.value = a.dataset.plan;
    });
  });

  function setStatus(msg, ok) {
    status.textContent = msg;
    status.className = "form-status " + (ok ? "ok" : "err");
  }

  function validate() {
    var valid = true;
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      var bad = !el.checkValidity();
      el.classList.toggle("invalid", bad);
      if (bad) valid = false;
    });
    if (!valid) {
      setStatus("Por favor completa los campos obligatorios (*) correctamente.", false);
      var first = form.querySelector(".invalid");
      if (first) first.focus();
    }
    return valid;
  }

  function buildMessage() {
    var f = form.elements;
    var lines = [
      "Hola AGROYAURI SAC, quisiera solicitar una cotización:",
      "",
      "• Nombre: " + f.nombre.value.trim(),
      f.empresa.value.trim() ? "• Empresa: " + f.empresa.value.trim() : null,
      "• Teléfono: " + f.telefono.value.trim(),
      "• Correo: " + f.correo.value.trim(),
      "• Servicio: " + f.servicio.value,
      "• Distrito / Ubicación: " + f.distrito.value.trim(),
      f.area.value ? "• Área aproximada: " + f.area.value + " m²" : null,
      f.mensaje.value.trim() ? "• Mensaje: " + f.mensaje.value.trim() : null
    ];
    return lines.filter(function (l) { return l !== null; }).join("\n");
  }

  form.addEventListener("input", function (e) {
    if (e.target.classList.contains("invalid") && e.target.checkValidity()) {
      e.target.classList.remove("invalid");
    }
  });

  form.querySelector('[data-send="whatsapp"]').addEventListener("click", function () {
    if (!validate()) return;
    var url = "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(buildMessage());
    window.open(url, "_blank", "noopener");
    setStatus("Abrimos WhatsApp con tu solicitud. ¡Gracias por escribirnos!", true);
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validate()) return;
    var subject = "Solicitud de cotización - " + form.elements.servicio.value;
    window.location.href = "mailto:" + EMAIL + "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(buildMessage());
    setStatus("Se abrió tu correo con la solicitud lista para enviar a " + EMAIL + ".", true);
  });
})();

/* joke-form.js — a vendégkönyv/kapcsolat oldalak "beküldés" gombjaihoz.
 * Egyik form sem küld semmit sehova (data-joke-message figyelmeztet erre is
 * a felhasználónak egy retro, alulról felcsúszó sávban), csak a gesztus
 * kedvéért lehet gépelni/kattintani beléjük. */
(function () {
  "use strict";

  function showToast(message) {
    var toast = document.getElementById("retro-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("retro-toast-visible");
    if (showToast._timer) clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () {
      toast.classList.remove("retro-toast-visible");
    }, 3200);
  }

  function init() {
    var forms = document.querySelectorAll("form[data-joke-message]");
    forms.forEach(function (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        showToast(form.getAttribute("data-joke-message"));
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

(function () {
  const fine = window.matchMedia("(pointer:fine)").matches;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function boot() {
    const bar = document.createElement("div");
    bar.className = "progress";
    document.body.appendChild(bar);
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - innerHeight;
      bar.style.width = (h > 0 ? (scrollY / h) * 100 : 0) + "%";
    };
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    if (fine && !reduce) {
      const c = document.createElement("div");
      c.className = "cursor on";
      document.body.appendChild(c);
      addEventListener("pointermove", (e) => {
        c.style.left = e.clientX + "px";
        c.style.top = e.clientY + "px";
        c.classList.toggle("hot", !!e.target.closest("a, button, .card"));
      }, { passive: true });
      const heroImg = document.querySelector(".hero-visual img");
      if (heroImg) {
        const hero = document.querySelector(".hero");
        hero?.addEventListener("pointermove", (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - .5;
          const y = (e.clientY - r.top) / r.height - .5;
          heroImg.style.transform = "scale(1.08) translate(" + (x * -16) + "px," + (y * -12) + "px)";
        });
        hero?.addEventListener("pointerleave", () => heroImg.style.removeProperty("transform"));
      }
    }

    document.body.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add], #add");
      if (!add) return;
      const badge = document.querySelector("[data-cart-count]");
      if (!badge || reduce) return;
      const from = add.getBoundingClientRect();
      const to = badge.getBoundingClientRect();
      const dot = document.createElement("i");
      dot.className = "fly";
      dot.style.left = from.left + from.width / 2 + "px";
      dot.style.top = from.top + from.height / 2 + "px";
      document.body.appendChild(dot);
      requestAnimationFrame(() => {
        dot.style.transform = "translate(" + (to.left - from.left) + "px," + (to.top - from.top) + "px) scale(.4)";
        dot.style.opacity = "0.2";
      });
      setTimeout(() => { dot.remove(); badge.classList.add("pop"); setTimeout(() => badge.classList.remove("pop"), 360); }, 700);
    });

    document.querySelectorAll(".card .photo").forEach((photo) => {
      if (photo.querySelector(".meta-pop")) return;
      const cap = document.createElement("span");
      cap.className = "meta-pop";
      cap.textContent = "Xem chi tiết";
      photo.appendChild(cap);
    });
    new MutationObserver(() => {
      document.querySelectorAll(".card .photo").forEach((photo) => {
        if (photo.querySelector(".meta-pop")) return;
        const cap = document.createElement("span");
        cap.className = "meta-pop";
        cap.textContent = "Xem chi tiết";
        photo.appendChild(cap);
      });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

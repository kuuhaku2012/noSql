(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function boot() {
    const bar = document.createElement("div");
    bar.className = "progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
    let progressFrame = 0;
    const updateProgress = () => {
      progressFrame = 0;
      const scrollable = document.documentElement.scrollHeight - innerHeight;
      const progress = scrollable > 0 ? Math.min(1, Math.max(0, scrollY / scrollable)) : 0;
      bar.style.transform = `scaleX(${progress})`;
    };
    const scheduleProgress = () => {
      if (!progressFrame) progressFrame = requestAnimationFrame(updateProgress);
    };
    addEventListener("scroll", scheduleProgress, { passive: true });
    addEventListener("resize", scheduleProgress, { passive: true });
    updateProgress();

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

    const addCaption = (photo) => {
      if (photo.querySelector(".meta-pop")) return;
      const cap = document.createElement("span");
      cap.className = "meta-pop";
      cap.setAttribute("aria-hidden", "true");
      cap.textContent = "Xem chi tiết";
      photo.appendChild(cap);
    };
    const decoratePhotos = (scope) => {
      if (scope.matches?.(".card .photo")) addCaption(scope);
      scope.querySelectorAll?.(".card .photo").forEach(addCaption);
    };
    decoratePhotos(document);
    new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) decoratePhotos(node);
      }));
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

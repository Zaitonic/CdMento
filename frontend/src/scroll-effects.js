// Framework-independent scroll effects. Call the returned cleanup on navigation.
export function initScrollEffects(root) {
  if (!root) return () => {};
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const header = root.querySelector(".public-header");
  const targets = [
    ...root.querySelectorAll(
      ".tools-strip, .feature-grid, .how-section > .section-intro, .how-steps, .final-cta, .public-footer",
    ),
  ];
  let frame = 0;
  let observer;
  function update() {
    frame = 0;
    const distance = document.documentElement.scrollHeight - window.innerHeight;
    const progress =
      distance > 0 ? Math.max(0, Math.min(1, window.scrollY / distance)) : 0;
    root.style.setProperty("--page-scroll", String(progress));
    header?.classList.toggle("is-scrolled", window.scrollY > 24);
  }
  function onScroll() {
    if (!frame) frame = window.requestAnimationFrame(update);
  }
  function setupReveals() {
    observer?.disconnect();
    targets.forEach((target) =>
      target.classList.remove("scroll-reveal", "is-revealed"),
    );
    if (media.matches || !("IntersectionObserver" in window)) return;
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0, rootMargin: "0px 0px -35px 0px" },
    );
    targets.forEach((target) => {
      // Hash links and restored scroll positions should remain immediately visible.
      if (target.getBoundingClientRect().top < window.innerHeight - 35) return;
      target.classList.add("scroll-reveal");
      observer.observe(target);
    });
  }
  setupReveals();
  update();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  media.addEventListener("change", setupReveals);
  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    media.removeEventListener("change", setupReveals);
    observer?.disconnect();
    targets.forEach((target) =>
      target.classList.remove("scroll-reveal", "is-revealed"),
    );
    header?.classList.remove("is-scrolled");
    root.style.removeProperty("--page-scroll");
  };
}

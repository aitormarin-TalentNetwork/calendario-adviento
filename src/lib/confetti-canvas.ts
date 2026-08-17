/**
 * TAL-40 — motor de partículas de confeti en canvas para el efecto de
 * "primera apertura" (design/design-system.md § "Grid de días" →
 * "Efecto de 'primera apertura'"). Portado del prototipo funcional
 * `design/propuesta-grid-calendario.html` (`burstConfetti`/
 * `tickConfetti`) — misma física/valores, solo tipado y adaptado a un
 * canvas ya montado por React en vez de `document.getElementById`.
 *
 * Deliberadamente fuera de React (sin estado, sin hooks): las partículas
 * se mueven en cada frame vía `requestAnimationFrame`, y disparar un
 * render de React 60 veces por segundo por cada partícula sería mucho
 * más caro que dejar que el canvas se dibuje solo — el propio canvas ya
 * es la forma estándar de animación imperativa en el DOM.
 */

const CONFETTI_COLORS = ["#c99a3d", "#e3bb63", "#8c2f39", "#f6f1e4", "#234a3b", "#e08a92"];

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  color: string;
  life: number;
  decay: number;
};

export type ConfettiEngine = {
  burst(x: number, y: number): void;
  destroy(): void;
};

export function createConfettiEngine(canvas: HTMLCanvasElement): ConfettiEngine {
  const ctx = canvas.getContext("2d");
  let particles: Particle[] = [];
  let rafId: number | null = null;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  function tick() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.vy += 0.18; // gravedad
      p.vx *= 0.992;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vrot;
      p.life -= p.decay;
      ctx.save();
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      ctx.restore();
    });
    particles = particles.filter((p) => p.life > 0 && p.y < canvas.height + 40);
    if (particles.length) {
      rafId = requestAnimationFrame(tick);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      rafId = null;
    }
  }

  function burst(x: number, y: number) {
    const count = 130;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3.5 + Math.random() * 8.5;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3, // sesgo hacia arriba, como piñata
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.35,
        size: 4 + Math.random() * 5,
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
        life: 1,
        decay: 0.007 + Math.random() * 0.008,
      });
    }
    if (rafId === null) rafId = requestAnimationFrame(tick);
  }

  function destroy() {
    window.removeEventListener("resize", resize);
    if (rafId !== null) cancelAnimationFrame(rafId);
    particles = [];
  }

  return { burst, destroy };
}

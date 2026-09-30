import { useEffect, useRef, useState } from "react";

// Easter egg: the Red Bull can slowly walks the edges of the screen.
// Hover pauses it and shows the note, click pops it (spin + "psssht").
const SIZE = 44;       // w-11 h-11
const MARGIN = 12;     // matches the old bottom-3/right-3 spot
const SPEED = 45;      // px per second

type Edge = "bottom" | "left" | "top" | "right";

export function WanderingCan({ src = "/redbullicon.png" }: { src?: string }) {
  const wrapRef = useRef<HTMLButtonElement>(null);
  const distRef = useRef(0);          // distance travelled along the perimeter
  const pausedRef = useRef(false);
  const [edge, setEdge] = useState<Edge>("bottom");
  const [alignEnd, setAlignEnd] = useState(true); // tooltip hugs the right/bottom side
  const [popped, setPopped] = useState(false);
  const [hovered, setHovered] = useState(false);

  pausedRef.current = hovered || popped;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let last = performance.now();
    let lastEdge: Edge | null = null;
    let lastAlign: boolean | null = null;

    const place = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const w = Math.max(window.innerWidth - 2 * MARGIN - SIZE, 0);
      const h = Math.max(window.innerHeight - 2 * MARGIN - SIZE, 0);
      const perim = 2 * (w + h) || 1;

      if (!pausedRef.current && !reduceMotion) distRef.current = (distRef.current + SPEED * dt) % perim;
      const d = distRef.current;

      // Start bottom-right, go left along the bottom, up the left, right along the top, down the right.
      let x: number, y: number, e: Edge;
      if (d < w) { x = w - d; y = h; e = "bottom"; }
      else if (d < w + h) { x = 0; y = h - (d - w); e = "left"; }
      else if (d < 2 * w + h) { x = d - w - h; y = 0; e = "top"; }
      else { x = w; y = d - 2 * w - h; e = "right"; }

      const wobble = pausedRef.current || reduceMotion ? 0 : Math.sin(now / 180) * 7;
      el.style.transform = `translate(${MARGIN + x}px, ${MARGIN + y}px) rotate(${wobble}deg)`;

      const align = e === "bottom" || e === "top" ? x > w / 2 : y > h / 2;
      if (e !== lastEdge) { lastEdge = e; setEdge(e); }
      if (align !== lastAlign) { lastAlign = align; setAlignEnd(align); }

      raf = requestAnimationFrame(place);
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Tooltip always opens toward the middle of the screen.
  const tipPos: Record<Edge, string> = {
    bottom: `bottom-full mb-1.5 ${alignEnd ? "right-0" : "left-0"}`,
    top: `top-full mt-1.5 ${alignEnd ? "right-0" : "left-0"}`,
    left: `left-full ml-2 ${alignEnd ? "bottom-0" : "top-0"}`,
    right: `right-full mr-2 ${alignEnd ? "bottom-0" : "top-0"}`,
  };

  return (
    <button
      ref={wrapRef}
      type="button"
      onClick={() => { setPopped(true); setTimeout(() => setPopped(false), 900); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className="fixed top-0 left-0 z-50 group cursor-pointer bg-transparent border-0 p-0 will-change-transform"
      style={{ transform: `translate(calc(100vw - ${MARGIN + SIZE}px), calc(100vh - ${MARGIN + SIZE}px))` }}
      aria-label=""
      data-testid="easter-egg-redbull"
    >
      <div className="relative">
        <img
          src={src}
          alt=""
          draggable={false}
          className={`w-11 h-11 object-contain select-none opacity-50 group-hover:opacity-100 transition-all duration-200 ${popped ? "rotate-[360deg] scale-125 opacity-100" : ""}`}
          style={{ transitionDuration: popped ? "700ms" : undefined }}
        />
        <div className={`absolute ${tipPos[edge]} opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap`}>
          <div className="bg-gray-900 text-white text-[10px] rounded py-1.5 px-2.5 shadow-lg border border-gray-700 text-center">
            {popped ? "psssht! gives you wings" : "Created By Jorgey Porgie"}
          </div>
        </div>
      </div>
    </button>
  );
}

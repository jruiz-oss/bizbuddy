import { useEffect, useRef, useState } from "react";
import { getApiUrl } from "@/lib/queryClient";

// Easter egg: the Red Bull can slowly walks the edges of the screen.
// Hover pauses it and shows the note, click pops it (spin + "psssht").
const SIZE = 44;       // w-11 h-11
const MARGIN = 12;     // matches the old bottom-3/right-3 spot
const SPEED = 45;      // px per second
const PHOTO = getApiUrl("/api/easter-egg/photo"); // Jorge's BizBuddy profile picture
const PRIZE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const GRID = 5;               // photo splits into GRID x GRID flipping blocks
const PHOTO_SIZE = 240;
const RAIN_MS = 1200;

type Edge = "bottom" | "left" | "top" | "right";

export function WanderingCan({ src = "/redbullicon.png" }: { src?: string }) {
  const wrapRef = useRef<HTMLButtonElement>(null);
  const distRef = useRef(0);          // distance travelled along the perimeter
  const pausedRef = useRef(false);
  const [edge, setEdge] = useState<Edge>("bottom");
  const [alignEnd, setAlignEnd] = useState(true); // tooltip hugs the right/bottom side
  const [popped, setPopped] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [stage, setStage] = useState<"idle" | "rain" | "reveal">("idle");
  const [photoOk, setPhotoOk] = useState(true);
  const timers = useRef<number[]>([]);

  pausedRef.current = hovered || popped || stage !== "idle";

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Load the photo fresh on each click (not once on page load), so a failed
  // load earlier never sticks. Rain lasts long enough for it to arrive.
  const [photoSrc, setPhotoSrc] = useState(PHOTO);
  const loadPhoto = () => {
    const src = `${PHOTO}?t=${Date.now()}`;
    const img = new Image();
    img.onload = () => { setPhotoSrc(src); setPhotoOk(true); };
    img.onerror = () => setPhotoOk(false);
    img.src = src;
  };

  const startShow = () => {
    setPopped(true);
    timers.current.push(window.setTimeout(() => setPopped(false), 900));
    if (stage !== "idle") return;
    loadPhoto();
    setStage("rain");
    timers.current.push(window.setTimeout(() => setStage("reveal"), RAIN_MS));
  };

  // Stable random rain drops (cans) for this mount
  const drops = useRef(
    Array.from({ length: 36 }, () => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      dur: 0.6 + Math.random() * 0.5,
      size: 18 + Math.random() * 18,
      spin: (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 360),
    }))
  ).current;

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
    <>
    <style>{`
      @keyframes bb-can-fall { from { transform: translateY(-10vh) rotate(0deg); } to { transform: translateY(110vh) rotate(var(--spin)); } }
      @keyframes bb-block-in { from { transform: rotateY(90deg); opacity: 0; } to { transform: rotateY(0deg); opacity: 1; } }
      @keyframes bb-bubble-in { 0% { transform: scale(0); opacity: 0; } 70% { transform: scale(1.1); opacity: 1; } 100% { transform: scale(1); } }
      @keyframes bb-fade-in { from { opacity: 0; } to { opacity: 1; } }
    `}</style>

    {stage === "rain" && (
      <div className="fixed inset-0 z-[60] pointer-events-none overflow-hidden" data-testid="easter-egg-rain">
        {drops.map((d, i) => (
          <img
            key={i}
            src={src}
            alt=""
            className="absolute top-0 object-contain"
            style={{
              left: `${d.left}%`,
              width: d.size,
              height: d.size,
              ["--spin" as any]: `${d.spin}deg`,
              animation: `bb-can-fall ${d.dur}s linear ${d.delay}s both`,
            }}
          />
        ))}
      </div>
    )}

    {stage === "reveal" && (
      <div
        className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center"
        style={{ animation: "bb-fade-in 200ms ease-out" }}
        onClick={() => setStage("idle")}
        data-testid="easter-egg-reveal"
      >
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          {/* Old-school block transition: photo lands as tiles flipping in on a diagonal */}
          <div
            className="grid rounded-lg overflow-hidden shadow-2xl"
            style={{ width: PHOTO_SIZE, height: PHOTO_SIZE, gridTemplateColumns: `repeat(${GRID}, 1fr)`, perspective: 800 }}
          >
            {Array.from({ length: GRID * GRID }, (_, i) => {
              const r = Math.floor(i / GRID), c = i % GRID;
              return (
                <div
                  key={i}
                  style={{
                    backgroundImage: photoOk ? `url(${photoSrc})` : "linear-gradient(135deg, #1e3a8a, #dc2626)",
                    backgroundSize: `${GRID * 100}% ${GRID * 100}%`,
                    backgroundPosition: `${(c / (GRID - 1)) * 100}% ${(r / (GRID - 1)) * 100}%`,
                    animation: `bb-block-in 450ms ease-out ${(r + c) * 70}ms both`,
                  }}
                />
              );
            })}
          </div>
          {!photoOk && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-5xl font-bold pointer-events-none" style={{ animation: "bb-fade-in 300ms ease-out 800ms both" }}>
              J
            </div>
          )}

          {/* Speech bubble */}
          <a
            href={PRIZE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setStage("idle")}
            className="absolute -top-14 left-1/2 -translate-x-1/2 origin-bottom whitespace-nowrap"
            style={{ animation: "bb-bubble-in 350ms ease-out 1000ms both" }}
            data-testid="easter-egg-prize"
          >
            <div className="relative bg-white text-gray-900 text-sm font-semibold rounded-2xl px-4 py-2 shadow-lg border border-gray-200 hover:bg-yellow-50">
              Wow you actually clicked the can. Prize inside
              <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-white" />
            </div>
          </a>
        </div>
      </div>
    )}

    <button
      ref={wrapRef}
      type="button"
      onClick={startShow}
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
          className={`w-11 h-11 object-contain select-none opacity-75 group-hover:opacity-100 transition-all duration-200 ${popped ? "rotate-[360deg] scale-125 opacity-100" : ""}`}
          style={{ transitionDuration: popped ? "700ms" : undefined }}
        />
        <div className={`absolute ${tipPos[edge]} opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap`}>
          <div className="bg-gray-900 text-white text-[10px] rounded py-1.5 px-2.5 shadow-lg border border-gray-700 text-center">
            {popped ? "psssht! gives you wings" : "Created By Jorgey Porgie"}
          </div>
        </div>
      </div>
    </button>
    </>
  );
}

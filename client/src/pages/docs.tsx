import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { renderToStaticMarkup } from "react-dom/server";
import { Search, Home, ChevronLeft, ChevronRight, Menu, X, BookOpen, FileText } from "lucide-react";
import logoPath from "@/assets/bizbuddy-logo.png";
import { articles, bySlug, grouped } from "@/docs";

type TocItem = { id: string; text: string; level: number };

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

export default function Docs() {
  const [location, setLocation] = useLocation();
  const slug = location.replace(/^\/docs\/?/, "").replace(/\/$/, "") || "intro";
  const article = bySlug(slug);

  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Full text index, built once on first use.
  const index = useMemo(
    () =>
      articles.map((a) => ({
        slug: a.slug,
        title: a.title,
        group: a.group,
        description: a.description,
        text: stripHtml(renderToStaticMarkup(<>{a.body()}</>)),
      })),
    [],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/);
    return index
      .map((a) => {
        const title = a.title.toLowerCase();
        const hay = `${title} ${a.description.toLowerCase()} ${a.text.toLowerCase()}`;
        if (!words.every((w) => hay.includes(w))) return null;
        const score = words.reduce((s, w) => s + (title.includes(w) ? 10 : 0) + (a.description.toLowerCase().includes(w) ? 3 : 0), 0);
        const pos = a.text.toLowerCase().indexOf(words[0]);
        const snippet = pos >= 0 ? a.text.slice(Math.max(0, pos - 50), pos + 110) : a.description;
        return { ...a, score, snippet };
      })
      .filter(Boolean)
      .sort((x, y) => y!.score - x!.score)
      .slice(0, 8) as Array<(typeof index)[number] & { score: number; snippet: string }>;
  }, [query, index]);

  // Cmd/Ctrl+K focuses search
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Reset scroll and rebuild the table of contents when the page changes.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    setMenuOpen(false);
    const els = Array.from(contentRef.current?.querySelectorAll<HTMLElement>("[data-doc-heading]") ?? []);
    const items = els.map((el) => ({ id: el.id, text: el.textContent ?? "", level: el.dataset.level === "3" ? 3 : 2 }));
    setToc(items);
    setActiveId(items[0]?.id ?? "");
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [slug]);

  const flat = articles;
  const i = flat.findIndex((a) => a.slug === slug);
  const prev = i > 0 ? flat[i - 1] : null;
  const next = i >= 0 && i < flat.length - 1 ? flat[i + 1] : null;

  const goto = (s: string) => {
    setQuery("");
    setSearchOpen(false);
    setLocation(`/docs/${s}`);
  };

  const nav = (
    <nav className="space-y-6">
      {grouped.map(({ group, items }) => (
        <div key={group}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 px-3 mb-1.5">{group}</p>
          <div className="space-y-0.5">
            {items.map((a) => {
              const active = a.slug === slug;
              return (
                <Link
                  key={a.slug}
                  href={`/docs/${a.slug}`}
                  className={`block px-3 py-1.5 rounded-lg text-[14px] transition-colors ${
                    active ? "bg-[#001f3f] text-white font-medium" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                  data-testid={`docs-nav-${a.slug}`}
                >
                  {a.title}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-white" data-testid="page-docs">
      {/* Top bar */}
      <header className="sticky top-0 z-40 h-14 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="h-full max-w-[1400px] mx-auto px-4 flex items-center gap-3">
          <button className="lg:hidden p-2 -ml-2 text-gray-600" onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle menu" data-testid="docs-menu-toggle">
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <Link href="/docs" className="flex items-center gap-2.5 shrink-0">
            <img src={logoPath} alt="BizBuddy" className="h-7 w-auto object-contain" />
            <span className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 border-l border-gray-200 pl-2.5">
              <BookOpen className="w-4 h-4" /> Docs
            </span>
          </Link>

          <div className="relative flex-1 max-w-md mx-auto">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder="Search the docs..."
              className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-12 py-2 text-[14px] text-gray-700 placeholder-gray-400 focus:outline-none focus:bg-white focus:border-gray-300"
              data-testid="docs-search"
            />
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 font-medium pointer-events-none">⌘K</kbd>
            {searchOpen && query.trim() && (
              <div className="absolute left-0 right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                {results.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-gray-500">No results for "{query}"</p>
                ) : (
                  results.map((r) => (
                    <button
                      key={r.slug}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => goto(r.slug)}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex gap-3 items-start border-b border-gray-100 last:border-0"
                    >
                      <FileText className="w-4 h-4 text-gray-400 mt-1 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900">
                          {r.title} <span className="text-xs font-normal text-gray-400 ml-1">{r.group}</span>
                        </span>
                        <span className="block text-xs text-gray-500 truncate">{r.snippet}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <Link
            href="/dashboard"
            className="shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#001f3f] text-white text-sm font-medium hover:bg-[#00305f] transition-colors"
            data-testid="docs-home-button"
          >
            <Home className="w-4 h-4" />
            <span className="hidden sm:inline">Home</span>
          </Link>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto flex">
        {/* Left nav (desktop) */}
        <aside className="hidden lg:block w-64 shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] overflow-y-auto py-8 pl-4 pr-3 border-r border-gray-100">
          {nav}
        </aside>

        {/* Left nav (mobile drawer) */}
        {menuOpen && (
          <div className="lg:hidden fixed inset-0 top-14 z-30 bg-white overflow-y-auto p-4">{nav}</div>
        )}

        {/* Content */}
        <main className="flex-1 min-w-0 px-6 lg:px-12 py-10">
          <div className="max-w-3xl mx-auto xl:mx-0 xl:ml-4">
            {article ? (
              <article>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-orange-600 mb-2">{article.group}</p>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">{article.title}</h1>
                <p className="text-base text-gray-500 mb-8">{article.description}</p>
                <div ref={contentRef} key={article.slug}>{article.body()}</div>

                <div className="mt-14 pt-6 border-t border-gray-200 grid grid-cols-2 gap-4">
                  {prev ? (
                    <Link href={`/docs/${prev.slug}`} className="group border border-gray-200 rounded-xl px-4 py-3 hover:border-gray-300 hover:shadow-sm transition">
                      <span className="flex items-center gap-1 text-xs text-gray-400"><ChevronLeft className="w-3.5 h-3.5" /> Previous</span>
                      <span className="block text-sm font-medium text-gray-900 mt-0.5">{prev.title}</span>
                    </Link>
                  ) : <span />}
                  {next ? (
                    <Link href={`/docs/${next.slug}`} className="group border border-gray-200 rounded-xl px-4 py-3 hover:border-gray-300 hover:shadow-sm transition text-right">
                      <span className="flex items-center justify-end gap-1 text-xs text-gray-400">Next <ChevronRight className="w-3.5 h-3.5" /></span>
                      <span className="block text-sm font-medium text-gray-900 mt-0.5">{next.title}</span>
                    </Link>
                  ) : <span />}
                </div>
              </article>
            ) : (
              <div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Page not found</h1>
                <p className="text-gray-500 mb-6">That docs page does not exist.</p>
                <Link href="/docs" className="text-sky-700 underline underline-offset-2">Back to the docs home</Link>
              </div>
            )}
          </div>
        </main>

        {/* Right TOC */}
        <aside className="hidden xl:block w-60 shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] overflow-y-auto py-10 pr-4">
          {toc.length > 0 && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-3">On this page</p>
              <ul className="space-y-1.5 border-l border-gray-200">
                {toc.map((t) => (
                  <li key={t.id}>
                    <a
                      href={`#${t.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(t.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                        setActiveId(t.id);
                      }}
                      className={`block -ml-px border-l-2 text-[13px] leading-5 py-0.5 ${t.level === 3 ? "pl-6" : "pl-3"} ${
                        activeId === t.id ? "border-[#001f3f] text-gray-900 font-medium" : "border-transparent text-gray-500 hover:text-gray-900"
                      }`}
                    >
                      {t.text}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

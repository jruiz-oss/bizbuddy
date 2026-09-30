import type { ReactNode } from "react";
import { Info, AlertTriangle, Lightbulb } from "lucide-react";

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} data-doc-heading className="scroll-mt-24 text-xl font-semibold text-gray-900 mt-10 mb-3 pb-2 border-b border-gray-200">
      {children}
    </h2>
  );
}

export function H3({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} data-doc-heading data-level="3" className="scroll-mt-24 text-base font-semibold text-gray-900 mt-6 mb-2">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-7 text-gray-700 mb-4">{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="list-disc pl-6 space-y-1.5 text-[15px] leading-7 text-gray-700 mb-4">{children}</ul>;
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal pl-6 space-y-2 text-[15px] leading-7 text-gray-700 mb-4 marker:font-semibold marker:text-gray-500">{children}</ol>;
}

export function B({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-gray-900">{children}</span>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="px-1.5 py-0.5 rounded bg-gray-100 text-[13px] text-gray-800 font-mono">{children}</code>;
}

const tones = {
  note: { icon: Info, box: "bg-sky-50 border-sky-200", text: "text-sky-900", label: "Note" },
  warn: { icon: AlertTriangle, box: "bg-amber-50 border-amber-200", text: "text-amber-900", label: "Heads up" },
  tip: { icon: Lightbulb, box: "bg-emerald-50 border-emerald-200", text: "text-emerald-900", label: "Tip" },
} as const;

export function Callout({ tone = "note", title, children }: { tone?: keyof typeof tones; title?: string; children: ReactNode }) {
  const t = tones[tone];
  const Icon = t.icon;
  return (
    <div className={`flex gap-3 rounded-xl border px-4 py-3.5 mb-5 ${t.box}`}>
      <Icon className={`w-[18px] h-[18px] mt-1 shrink-0 ${t.text}`} />
      <div className={`text-[14px] leading-6 ${t.text}`}>
        <p className="font-semibold mb-0.5">{title ?? t.label}</p>
        <div className="[&_p]:mb-0">{children}</div>
      </div>
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto mb-5 rounded-xl border border-gray-200">
      <table className="w-full text-[14px] text-left">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-3 leading-6 ${j === 0 ? "font-medium text-gray-900 whitespace-nowrap" : "text-gray-700"}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

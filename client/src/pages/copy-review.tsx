import { useState, useEffect, useRef } from "react";

// Decode a base64url (or plain base64) string to UTF-8 text
function decodeBase64(s: string): string {
  if (!s) return "";
  try {
    // base64url → base64
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
  } catch {
    return "";
  }
}

export default function CopyReview() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; visible: boolean; err: boolean }>({
    msg: "",
    visible: false,
    err: false,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const params = new URLSearchParams(window.location.search);
  const plainText = decodeBase64(params.get("data") || "");
  const richHtml = decodeBase64(params.get("html") || "");

  function showToast(msg: string, isErr = false) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ msg, visible: true, err: isErr });
    timerRef.current = setTimeout(
      () => setToast((t) => ({ ...t, visible: false })),
      2400
    );
  }

  async function doCopy() {
    setError(null);
    // Try rich clipboard (preserves card formatting)
    if (richHtml && navigator.clipboard && (window as any).ClipboardItem) {
      try {
        await navigator.clipboard.write([
          new (window as any).ClipboardItem({
            "text/html": new Blob([richHtml], { type: "text/html" }),
            "text/plain": new Blob([plainText], { type: "text/plain" }),
          }),
        ]);
        setCopied(true);
        showToast("Copied! Now paste into any app.");
        setTimeout(() => setCopied(false), 2500);
        return;
      } catch {
        // fall through
      }
    }
    // Async plain-text clipboard
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(plainText);
        setCopied(true);
        showToast("Copied! Now paste into any app.");
        setTimeout(() => setCopied(false), 2500);
        return;
      } catch {
        // fall through
      }
    }
    // Legacy fallback
    const ta = document.createElement("textarea");
    ta.value = plainText;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, plainText.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    if (ok) {
      setCopied(true);
      showToast("Copied! Now paste into any app.");
      setTimeout(() => setCopied(false), 2500);
    } else {
      setError("Copy failed — your browser may not support this. Try selecting and copying the preview text manually.");
      showToast("Copy failed", true);
    }
  }

  if (!plainText) {
    return (
      <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif", background: "#f9fafb", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
        <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", padding: 24, maxWidth: 680, width: "100%" }}>
          <h1 style={{ color: "#001f3f", fontSize: 20, marginBottom: 8 }}>Review Copy</h1>
          <p style={{ color: "#6b7280", fontSize: 14 }}>This link appears to be invalid or expired.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
        background: "#f9fafb",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 16px",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
          padding: 24,
          maxWidth: 680,
          width: "100%",
        }}
      >
        <h1 style={{ color: "#001f3f", fontSize: 20, marginBottom: 4 }}>Review Copy</h1>
        <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 20, lineHeight: 1.5 }}>
          Tap the button below to copy these reviews, then paste them anywhere — email, Docs, notes, a text message, anywhere.
        </p>

        <button
          onClick={doCopy}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: copied ? "#16a34a" : "#001f3f",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "16px 24px",
            fontSize: 16,
            fontWeight: 600,
            cursor: "pointer",
            width: "100%",
            marginBottom: 16,
            transition: "background 0.15s",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {copied ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          )}
          {copied ? "✓ Copied!" : "Copy to Mobile / Desktop"}
        </button>

        {error && (
          <p style={{ color: "#b91c1c", fontSize: 13, marginBottom: 12 }}>{error}</p>
        )}

        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px", color: "#6b7280", fontWeight: 600, marginBottom: 8 }}>
          Preview
        </div>
        <div
          style={{
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            padding: 16,
            maxHeight: 500,
            overflowY: "auto",
            background: "#fff",
            WebkitOverflowScrolling: "touch",
          }}
          dangerouslySetInnerHTML={{ __html: richHtml || `<pre style="white-space:pre-wrap;font-size:13px;color:#374151;">${plainText.replace(/</g, "&lt;")}</pre>` }}
        />

        <p style={{ marginTop: 16, fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
          Generated by BizBuddy
        </p>
      </div>

      {/* Toast */}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          left: "50%",
          transform: `translateX(-50%) translateY(${toast.visible ? "0" : "120%"})`,
          background: toast.err ? "#b91c1c" : "#001f3f",
          color: "#fff",
          padding: "12px 20px",
          borderRadius: 999,
          fontSize: 14,
          fontWeight: 600,
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          transition: "transform 0.3s ease",
          zIndex: 50,
          pointerEvents: "none",
        }}
      >
        {toast.msg}
      </div>
    </div>
  );
}

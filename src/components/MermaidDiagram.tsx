import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { sanitizeMermaid } from "@/lib/sanitizeMermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "loose",
  fontFamily: "Inter, sans-serif",
});

let counter = 0;

export function MermaidDiagram({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [sanitized, setSanitized] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const clean = sanitizeMermaid(chart);
    if (!clean) {
      setSanitized(null);
      setError(true);
      return;
    }

    setSanitized(clean);
    setError(false);
    const id = `mermaid-${++counter}`;

    mermaid
      .render(id, clean)
      .then(({ svg }) => {
        if (ref.current) ref.current.innerHTML = svg;
      })
      .catch((err) => {
        console.debug("[MermaidDiagram] Render failed after sanitization:", err);
        setError(true);
      });
  }, [chart]);

  if (error) {
    return (
      <div className="bg-muted rounded-lg p-4 text-sm text-muted-foreground font-display">
        Mermaid diagram could not be rendered. Content sanitized.
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="my-4 flex justify-center overflow-x-auto rounded-lg bg-card border border-border p-4"
    />
  );
}

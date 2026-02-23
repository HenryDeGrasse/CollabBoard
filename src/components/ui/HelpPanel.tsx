import React, { useEffect, useMemo, useState } from "react";
import { HelpCircle, X } from "lucide-react";

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export function getShortcuts(mac: boolean) {
  const mod = mac ? "⌘" : "Ctrl";
  return [
    { section: "Tools" },
    { key: "V", desc: "Select tool" },
    { key: "S", desc: "Sticky Note tool" },
    { key: "R", desc: "Rectangle tool" },
    { key: "C", desc: "Circle tool" },
    { key: "A", desc: "Arrow / Connector tool" },
    { key: "L", desc: "Line tool" },
    { key: "F", desc: "Frame tool" },
    { section: "Actions" },
    { key: "Delete / Backspace", desc: "Delete selected objects" },
    { key: "Escape", desc: "Return to Select tool" },
    { key: `${mod} + Z`, desc: "Undo" },
    { key: `${mod} + Shift + Z`, desc: "Redo" },
    { key: `${mod} + Y`, desc: "Redo (alternate)" },
    { key: `${mod} + C`, desc: "Copy selected" },
    { key: `${mod} + V`, desc: "Paste" },
    { key: `${mod} + D`, desc: "Duplicate selected" },
    { section: "Creating" },
    { key: "Click + Drag", desc: "Draw shape / sticky to size" },
    { key: "Click (no drag)", desc: "Place default-sized object" },
    { key: "Shift (while rotating)", desc: "Snap rotation to 15°" },
    { section: "Navigation" },
    { key: "Space + Drag", desc: "Pan canvas" },
    { key: "Right-click + Drag", desc: "Pan canvas" },
    { key: "Scroll", desc: "Zoom in / out" },
    { section: "Editing" },
    { key: "Double-click", desc: "Edit text on object" },
    { key: "Click away / Escape", desc: "Finish editing" },
    { key: "?", desc: "Toggle this help panel" },
    { section: "Connectors" },
    { key: "A then click two objects", desc: "Connect with arrow" },
    { key: "Click connector midpoint", desc: "Select connector (then Delete)" },
  ] as const;
}

// For backward compat with tests
export const shortcuts = getShortcuts(isMac);

export const HelpPanel = React.memo(function HelpPanel() {
  const [open, setOpen] = useState(false);
  const resolvedShortcuts = useMemo(() => getShortcuts(isMac), []);

  // Toggle with ? key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      {/* Help button — inline, sits inside parent container */}
      <button
        onClick={() => setOpen(true)}
        className="w-8 h-8 sharp-corners flex items-center justify-center hover:bg-neutral-200 border border-transparent hover:border-newsprint-fg transition-colors text-newsprint-fg"
        title="Keyboard shortcuts (?)"
      >
        <HelpCircle size={16} strokeWidth={1.5} />
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          data-testid="help-panel-backdrop"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-newsprint-bg border-2 border-newsprint-fg sharp-corners shadow-[8px_8px_0px_0px_#111111] w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b-2 border-newsprint-fg">
              <h2 className="text-xl font-black font-serif text-newsprint-fg uppercase tracking-widest">Keyboard Shortcuts</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-1 sharp-corners hover:bg-neutral-200 border border-transparent hover:border-newsprint-fg transition-colors text-newsprint-fg"
              >
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>

            {/* Shortcuts list */}
            <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-1">
              {resolvedShortcuts.map((item, i) => {
                if ("section" in item && !("key" in item)) {
                  return (
                    <div key={i} className={`text-[10px] font-mono font-bold uppercase tracking-widest text-newsprint-muted ${i > 0 ? "pt-4 pb-1" : "pb-1"}`}>
                      {item.section}
                    </div>
                  );
                }
                if ("key" in item && "desc" in item) {
                  return (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-newsprint-muted last:border-0">
                      <span className="text-xs font-mono uppercase tracking-widest text-newsprint-fg font-bold">{item.desc}</span>
                      <kbd className="inline-flex items-center px-2 py-0.5 text-[10px] font-mono font-bold bg-neutral-200 border border-newsprint-fg sharp-corners text-newsprint-fg">
                        {item.key}
                      </kbd>
                    </div>
                  );
                }
                return null;
              })}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 bg-neutral-100 border-t-2 border-newsprint-fg text-center">
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-newsprint-fg">Press <kbd className="px-1.5 py-0.5 bg-white border border-newsprint-fg sharp-corners">?</kbd> to toggle this panel</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Arena, ArenaCallbacks } from "@/game/arena";
import styles from "./ArenaCanvas.module.css";

export interface ArenaHandle {
  arena: Arena | null;
}

/**
 * Hosts the three.js arena. The engine is loaded on the client only and
 * owns its own render loop; React never re-renders the canvas.
 */
export const ArenaCanvas = forwardRef<ArenaHandle, {
  mode: "play" | "attract";
  seed?: number;
  callbacks?: ArenaCallbacks;
  onReady?: (arena: Arena) => void;
  onError?: (message: string) => void;
}>(function ArenaCanvas({ mode, seed = 1, callbacks, onReady, onError }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const handle = useRef<ArenaHandle>({ arena: null });
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useImperativeHandle(ref, () => handle.current, []);

  useEffect(() => {
    let disposed = false;
    let arena: Arena | null = null;
    const h = handle.current;
    void import("@/game/arena")
      .then(({ Arena: ArenaClass }) => {
        if (disposed || !canvas.current || !overlay.current) return;
        arena = new ArenaClass(
          canvas.current,
          overlay.current,
          mode,
          seed,
          { crosshair: styles.crosshair!, popup: styles.popup!, popupMult: styles.popupMult!, popupBad: styles.popupBad! },
          {
            onHud: (h) => cbRef.current?.onHud?.(h),
            onRadio: (t, f) => cbRef.current?.onRadio?.(t, f),
            onChain: (k, m) => cbRef.current?.onChain?.(k, m),
            onFinish: (r) => cbRef.current?.onFinish?.(r),
          },
        );
        h.arena = arena;
        if (process.env.NODE_ENV === "development") (window as unknown as { __arena?: Arena }).__arena = arena;
        onReady?.(arena);
      })
      .catch((err: unknown) => {
        console.error("arena failed to start", err);
        onError?.("The 3D arena could not start on this machine. Check that hardware acceleration is enabled in the browser.");
      });
    return () => {
      disposed = true;
      arena?.dispose();
      h.arena = null;
    };
    // The arena is created once per mount; mode and seed are fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.wrap} data-mode={mode}>
      <canvas ref={canvas} className={styles.canvas} />
      <div ref={overlay} className={styles.overlay} />
    </div>
  );
});

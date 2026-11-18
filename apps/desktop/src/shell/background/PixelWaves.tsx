/**
 * The desktop background (§14): the pixel-waves scene, drawn as inline SVG
 * (no image file), still, crisp at any size. Re-fits on resize and on
 * display-scale changes; the markup itself is built once.
 */
import { memo, useLayoutEffect, useRef, useState } from "react";
import { PARTS } from "./sceneParts.ts";
import { fitScene, sceneMarkup, type SceneFit } from "./scene.ts";
import "./pixelWaves.css";

const MARKUP = { __html: sceneMarkup() };

export const PixelWaves = memo(function PixelWaves() {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<SceneFit | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setFit((prev) => {
        const next = fitScene(r.width, r.height, window.devicePixelRatio || 1);
        return prev && prev.width === next.width && prev.height === next.height && prev.left === next.left ? prev : next;
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    let mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onDpr = () => {
      update();
      mq.removeEventListener("change", onDpr);
      mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener("change", onDpr);
    };
    mq.addEventListener("change", onDpr);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", onDpr);
    };
  }, []);

  return (
    <div ref={ref} className="pixel-waves" role="img" aria-label="Pixel-art ocean waves under a cream sky">
      {fit && (
        <svg
          className="pixel-waves__scene"
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${PARTS.tw} ${PARTS.vh}`}
          width={fit.width}
          height={fit.height}
          style={{ left: fit.left }}
          shapeRendering="crispEdges"
          preserveAspectRatio="none"
          aria-hidden="true"
          dangerouslySetInnerHTML={MARKUP}
        />
      )}
    </div>
  );
});

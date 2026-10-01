"use client";

import { cn } from "@/lib/utils";
import { useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";

export interface PixelFlowFieldProps {
  cellSize?: number;
  children?: ReactNode;
  className?: string;
  colors?: string[];
  gap?: number;
  paused?: boolean;
  pointerRadius?: number;
  pointerStrength?: number;
  shape?: "square" | "circle" | "cross";
  speed?: number;
  text?: string;
  weight?: number;
}

type Dot = { x: number; y: number; homeX: number; homeY: number; size: number; covered: boolean; phase: number };

const MAX_DPR = 2;
const MAX_DOTS = 5_000;

export default function PixelFlowField({
  cellSize = 6,
  children,
  className,
  colors = ["var(--line)", "var(--signal)", "var(--foreground)"],
  gap = 3,
  paused = false,
  pointerRadius = 120,
  pointerStrength = 0.7,
  shape = "square",
  speed = 0.6,
  text = "NEXA",
  weight = 800,
}: PixelFlowFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!(host && canvas)) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const colorProbe = document.createElement("span");
    colorProbe.hidden = true;
    host.append(colorProbe);
    const resolve = (input: string, fallback: string) => {
      colorProbe.style.color = input;
      return window.getComputedStyle(colorProbe).color || fallback;
    };
    const fieldColor = resolve(colors[0] ?? "var(--line)", "rgb(55 54 48)");
    const accentColor = resolve(colors[1] ?? "var(--signal)", "rgb(250 204 21)");
    const inkColor = resolve(colors[2] ?? "var(--foreground)", "rgb(238 237 229)");
    colorProbe.remove();

    let width = 1;
    let height = 1;
    let dots: Dot[] = [];
    let frame = 0;
    let visible = true;
    let pointerActive = false;
    let pointerX = 0;
    let pointerY = 0;
    const step = Math.max(4, cellSize + gap);

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      let actualStep = step;
      let cols = Math.ceil(width / actualStep);
      let rows = Math.ceil(height / actualStep);
      if (cols * rows > MAX_DOTS) {
        actualStep *= Math.sqrt((cols * rows) / MAX_DOTS);
        cols = Math.ceil(width / actualStep);
        rows = Math.ceil(height / actualStep);
      }

      const sampler = document.createElement("canvas");
      sampler.width = cols;
      sampler.height = rows;
      const sample = sampler.getContext("2d", { willReadFrequently: true });
      if (!sample) return;
      let fontSize = rows * 0.58;
      sample.font = `${weight} ${fontSize}px ${window.getComputedStyle(host).fontFamily}`;
      const measured = sample.measureText(text).width;
      const maxWidth = cols * 0.9;
      if (measured > maxWidth) fontSize *= maxWidth / measured;
      sample.font = `${weight} ${fontSize}px ${window.getComputedStyle(host).fontFamily}`;
      sample.fillStyle = "white";
      sample.textAlign = "center";
      sample.textBaseline = "middle";
      sample.fillText(text, cols / 2, rows * 0.2);
      const pixels = sample.getImageData(0, 0, cols, rows).data;

      dots = [];
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const alpha = pixels[(row * cols + col) * 4 + 3] ?? 0;
          const homeX = (col + 0.5) * actualStep;
          const homeY = (row + 0.5) * actualStep;
          dots.push({ x: homeX, y: homeY, homeX, homeY, size: Math.max(1.2, cellSize * (alpha > 40 ? 0.9 : 0.45)), covered: alpha > 40, phase: ((row * 31 + col * 17) % 97) / 97 });
        }
      }
    };

    const drawDot = (dot: Dot, time: number) => {
      const drift = reducedMotion ? 0 : Math.sin(time * 0.00035 * speed + dot.phase * 8) * (dot.covered ? 0.7 : 2.2);
      let x = dot.homeX + drift;
      let y = dot.homeY + Math.cos(time * 0.00028 * speed + dot.phase * 9) * (dot.covered ? 0.4 : 1.5);
      if (pointerActive && !reducedMotion) {
        const dx = x - pointerX;
        const dy = y - pointerY;
        const distance = Math.hypot(dx, dy);
        if (distance > 0 && distance < pointerRadius) {
          const force = (1 - distance / pointerRadius) * pointerStrength * 24;
          x += (dx / distance) * force;
          y += (dy / distance) * force;
        }
      }
      context.fillStyle = dot.covered ? (dot.phase > 0.72 ? inkColor : accentColor) : fieldColor;
      context.globalAlpha = dot.covered ? 0.78 : 0.2;
      const size = dot.size;
      if (shape === "circle") {
        context.beginPath(); context.arc(x, y, size / 2, 0, Math.PI * 2); context.fill();
      } else if (shape === "cross") {
        context.fillRect(x - size / 2, y - size * 0.15, size, size * 0.3);
        context.fillRect(x - size * 0.15, y - size / 2, size * 0.3, size);
      } else context.fillRect(x - size / 2, y - size / 2, size, size);
    };

    const render = (time = 0) => {
      context.clearRect(0, 0, width, height);
      for (const dot of dots) drawDot(dot, time);
      context.globalAlpha = 1;
    };
    const tick = (time: number) => {
      render(time);
      if (visible && !paused && !reducedMotion) frame = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      if (visible && !paused && !reducedMotion) frame = requestAnimationFrame(tick);
      else render();
    };
    const resizeObserver = new ResizeObserver(() => { build(); start(); });
    const intersectionObserver = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; start(); });
    const onVisibility = () => { visible = document.visibilityState === "visible"; start(); };
    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect(); pointerX = event.clientX - rect.left; pointerY = event.clientY - rect.top; pointerActive = true;
    };
    const clearPointer = () => { pointerActive = false; };

    resizeObserver.observe(canvas);
    intersectionObserver.observe(host);
    document.addEventListener("visibilitychange", onVisibility);
    host.addEventListener("pointermove", onPointer, { passive: true });
    host.addEventListener("pointerleave", clearPointer);
    build(); start();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect(); intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      host.removeEventListener("pointermove", onPointer); host.removeEventListener("pointerleave", clearPointer);
    };
  }, [cellSize, colors, gap, paused, pointerRadius, pointerStrength, reducedMotion, shape, speed, text, weight]);

  return <div className={cn("relative isolate overflow-hidden", className)} ref={hostRef}>
    <canvas aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" ref={canvasRef} />
    <div className="relative z-10 h-full">{children}</div>
  </div>;
}

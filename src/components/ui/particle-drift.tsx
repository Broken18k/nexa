"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

type Node = { x: number; y: number; speed: number; char: string };
type Beam = { x: number; y: number; length: number; speed: number; alpha: number };

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%&*()";
const MAX_DPR = 2;

export default function ParticleDrift({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!(canvas && context)) return;

    let width = 1;
    let height = 1;
    let frame = 0;
    let visible = document.visibilityState === "visible";
    let nodes: Node[] = [];
    let beams: Beam[] = [];
    const pointer = { x: -1_000, y: -1_000 };

    const randomChar = () => CHARS[Math.floor(Math.random() * CHARS.length)] ?? "N";
    const reset = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const density = width < 800 ? 42 : 88;
      nodes = Array.from({ length: density }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        speed: Math.random() * 0.24 + 0.06,
        char: randomChar(),
      }));
      beams = Array.from({ length: width < 800 ? 8 : 18 }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        length: Math.random() * 90 + 45,
        speed: Math.random() * 2.4 + 1.2,
        alpha: Math.random() * 0.2 + 0.12,
      }));
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      for (const beam of beams) {
        if (!reducedMotion) beam.y -= beam.speed;
        if (beam.y + beam.length < 0) { beam.y = height + beam.length; beam.x = Math.random() * width; }
        const gradient = context.createLinearGradient(beam.x, beam.y, beam.x, beam.y + beam.length);
        gradient.addColorStop(0, `color-mix(in srgb, rgb(250 204 21) ${Math.round(beam.alpha * 100)}%, transparent)`);
        gradient.addColorStop(1, "transparent");
        context.strokeStyle = gradient;
        context.lineWidth = 1;
        context.beginPath(); context.moveTo(beam.x, beam.y); context.lineTo(beam.x, beam.y + beam.length); context.stroke();
      }

      context.font = "10px DM Mono, monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (!node) continue;
        if (!reducedMotion) node.y += node.speed;
        if (node.y > height + 15) { node.y = -15; node.x = Math.random() * width; }
        const pointerDistance = Math.hypot(pointer.x - node.x, pointer.y - node.y);
        if (pointerDistance < 160 && Math.random() > 0.94) node.char = randomChar();
        for (let j = i + 1; j < nodes.length; j += 1) {
          const other = nodes[j];
          if (!other) continue;
          const distance = Math.hypot(node.x - other.x, node.y - other.y);
          if (distance < 105) {
            context.strokeStyle = `rgba(250, 204, 21, ${0.07 * (1 - distance / 105)})`;
            context.beginPath(); context.moveTo(node.x, node.y); context.lineTo(other.x, other.y); context.stroke();
          }
        }
        if (pointerDistance < 160) {
          context.strokeStyle = `rgba(250, 204, 21, ${0.3 * (1 - pointerDistance / 160)})`;
          context.beginPath(); context.moveTo(node.x, node.y); context.lineTo(pointer.x, pointer.y); context.stroke();
        }
        context.fillStyle = pointerDistance < 160 ? "rgb(250 204 21)" : "rgba(190, 176, 120, 0.26)";
        context.fillText(node.char, node.x, node.y);
      }
      if (visible && !reducedMotion) frame = requestAnimationFrame(draw);
    };

    const onPointer = (event: PointerEvent) => { pointer.x = event.clientX; pointer.y = event.clientY; };
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      cancelAnimationFrame(frame);
      if (visible) draw();
    };
    window.addEventListener("resize", reset);
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    reset();
    draw();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", reset);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reducedMotion]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
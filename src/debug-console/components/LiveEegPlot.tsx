import { useEffect, useRef } from "react";

interface LiveEegPlotProps {
  channelNames: string[];
  history: Record<string, number[]>;
}

const colors = [
  "#a78bfa",
  "#67e8f9",
  "#4ade80",
  "#818cf8",
  "#c4b5fd",
  "#38bdf8",
  "#86efac",
  "#e0e7ff",
];

export function LiveEegPlot({ channelNames, history }: LiveEegPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(rect.height * scale));
    context.setTransform(scale, 0, 0, scale, 0, 0);

    const width = rect.width;
    const height = rect.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#090f20";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "rgba(255, 255, 255, 0.07)";
    context.lineWidth = 1;

    for (let y = 48; y < height; y += 48) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    for (let x = 96; x < width; x += 96) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }

    channelNames.forEach((name, channelIndex) => {
      const values = history[name] ?? [];
      if (values.length < 2) return;

      const finite = values.filter(Number.isFinite);
      const mean =
        finite.reduce((total, value) => total + value, 0) / Math.max(1, finite.length);
      const centered = finite.map((value) => value - mean);
      const maxAbs = Math.max(1, ...centered.map((value) => Math.abs(value)));
      const laneHeight = height / Math.max(1, channelNames.length);
      const laneCenter = laneHeight * channelIndex + laneHeight / 2;
      const yScale = laneHeight * 0.38;

      context.strokeStyle = colors[channelIndex % colors.length];
      context.lineWidth = 1.5;
      context.beginPath();

      values.forEach((value, index) => {
        const x = (index / Math.max(1, values.length - 1)) * width;
        const y = laneCenter - ((value - mean) / maxAbs) * yScale;
        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });

      context.stroke();
    });
  }, [channelNames, history]);

  return (
    <canvas
      ref={canvasRef}
      className="live-plot"
      aria-label="Live EEG channel plot"
    />
  );
}


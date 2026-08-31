import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

interface InfoPopoverButtonProps {
  ariaLabel: string;
  children: ReactNode;
  preferredSide?: "left" | "right";
}

const popoverWidth = 320;
const viewportInset = 16;
const popoverGap = 12;

export function InfoPopoverButton({
  ariaLabel,
  children,
  preferredSide = "left",
}: InfoPopoverButtonProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!position) return;

    function closeOnOutsideClick(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && buttonRef.current?.contains(target)) return;
      setPosition(null);
    }

    window.addEventListener("click", closeOnOutsideClick);
    return () => window.removeEventListener("click", closeOnOutsideClick);
  }, [position]);

  function togglePopover() {
    if (position) {
      setPosition(null);
      return;
    }

    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;

    const preferredLeft =
      preferredSide === "left"
        ? rect.right - popoverWidth
        : rect.left;
    const fallbackLeft =
      preferredSide === "left"
        ? rect.left
        : rect.right - popoverWidth;
    const left =
      preferredLeft >= viewportInset &&
      preferredLeft + popoverWidth <= window.innerWidth - viewportInset
        ? preferredLeft
        : Math.min(
            window.innerWidth - popoverWidth - viewportInset,
            Math.max(viewportInset, fallbackLeft),
          );
    const top = Math.min(
      window.innerHeight - viewportInset,
      Math.max(viewportInset, rect.bottom + popoverGap),
    );

    setPosition({ left, top });
  }

  return (
    <>
      <button
        aria-expanded={position !== null}
        aria-label={ariaLabel}
        className="metric-info-button"
        onClick={togglePopover}
        ref={buttonRef}
        type="button"
      >
        <Info aria-hidden="true" />
      </button>
      {position &&
        createPortal(
        <div
          className="floating-info-popover"
          role="tooltip"
          style={{ left: position.left, top: position.top }}
        >
          {children}
        </div>,
          document.body,
        )}
    </>
  );
}


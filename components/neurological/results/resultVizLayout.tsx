'use client';

import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * Chiều cao thống nhất cho vùng show kết quả test (mọi bài, mọi kích thước màn hình trong ngưỡng hợp lý).
 * Một biểu thức duy nhất — không sm/lg khác nhau.
 */
/** Cùng một chiều cao cho mọi bài (dvh + cap px). */
export const RESULT_VIZ_BOX_CLASS = 'h-[min(62dvh,680px)] max-h-[85vh]';

/** Panel trái trong NeurologicalRunResults: cùng chiều cao tối thiểu với canvas. */
export const RESULT_CHART_PANEL_MIN = 'min-h-[min(62dvh,680px)]';

/** Cùng min-height cho drawer tham số (lg) để khớp cột biểu đồ. */
export const RESULT_CHART_PANEL_MIN_LG = 'lg:min-h-[min(62dvh,680px)]';

/**
 * Khung bọc SVG — không flex-1 để tránh kéo giãn thừa khi inner đã cố định chiều cao.
 */
export const RESULT_VIZ_OUTER = 'flex w-full shrink-0 flex-col items-stretch';

/**
 * Vùng canvas cố định — cùng kích thước cho mọi preview dùng ResultVizMaxFrame / RESULT_VIZ_INNER.
 */
export const RESULT_VIZ_INNER = `relative w-full shrink-0 overflow-hidden ${RESULT_VIZ_BOX_CLASS}`;

/** SVG lấp đầy vùng, giữ tỉ lệ viewBox (meet). */
export const RESULT_VIZ_SVG = 'absolute inset-0 block h-full w-full';

const ResultVizSizeContext = createContext<Readonly<{ width: number; height: number }> | null>(null);

/** Kích thước pixel của khung RESULT_VIZ_INNER — dùng để pad viewBox cho khớp tỉ lệ (lấp đầy khung, không viền letterbox). */
export function useResultVizContainerSize(): Readonly<{ width: number; height: number }> | null {
  return useContext(ResultVizSizeContext);
}

/**
 * Mở rộng hình chữ nhật nội dung (cw×ch) để có cùng tỉ lệ với khung hiển thị — với preserveAspectRatio meet,
 * SVG scale vừa khít khung mà không còn dải trống hai bên/trên dưới.
 */
export function padViewBoxToAspectRatio(
  cw: number,
  ch: number,
  containerW: number,
  containerH: number
): { vbW: number; vbH: number; padX: number; padY: number } {
  const cw0 = Math.max(cw, 1);
  const ch0 = Math.max(ch, 1);
  if (!(containerW > 0 && containerH > 0)) {
    return { vbW: cw0, vbH: ch0, padX: 0, padY: 0 };
  }
  const ar = containerW / containerH;
  const contentAr = cw0 / ch0;
  let vbW = cw0;
  let vbH = ch0;
  if (contentAr > ar) {
    vbH = cw0 / ar;
  } else {
    vbW = ch0 * ar;
  }
  const padX = (vbW - cw0) / 2;
  const padY = (vbH - ch0) / 2;
  return { vbW, vbH, padX, padY };
}

export type ResultVizAspectSvgProps = {
  contentWidth: number;
  contentHeight: number;
  /** Nền phủ full viewBox (sau khi pad tỉ lệ). */
  panelFill?: string;
  children: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<'svg'>, 'viewBox' | 'preserveAspectRatio' | 'children'>;

/**
 * SVG trong ResultVizMaxFrame: tự pad viewBox theo tỉ lệ khung thật để nội dung lấp đầy khung (meet không còn “hộp nhỏ trong hộp lớn”).
 * children vẽ trong không gian 0…contentWidth × 0…contentHeight.
 */
export function ResultVizAspectSvg({
  contentWidth: cw,
  contentHeight: ch,
  panelFill = 'rgb(15 23 42 / 0.4)',
  children,
  className,
  ...rest
}: ResultVizAspectSvgProps) {
  const container = useResultVizContainerSize();
  const { vbW, vbH, padX, padY } = useMemo(
    () =>
      container && container.width > 0 && container.height > 0
        ? padViewBoxToAspectRatio(cw, ch, container.width, container.height)
        : { vbW: Math.max(cw, 1), vbH: Math.max(ch, 1), padX: 0, padY: 0 },
    [cw, ch, container?.width, container?.height]
  );

  return (
    <svg
      className={className ?? RESULT_VIZ_SVG}
      viewBox={`0 0 ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      {...rest}
    >
      <rect x={0} y={0} width={vbW} height={vbH} fill={panelFill} />
      <g transform={`translate(${padX},${padY})`}>{children}</g>
    </svg>
  );
}

type Props = {
  children: React.ReactNode;
};

/**
 * Bọc layout cho biểu đồ — không thêm khung HTML thứ hai.
 */
export function ResultVizMaxFrame({ children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Readonly<{ width: number; height: number }> | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize({ width: r.width, height: r.height });
      }
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={RESULT_VIZ_OUTER}>
      <div ref={ref} className={RESULT_VIZ_INNER}>
        <ResultVizSizeContext.Provider value={size}>
          <div className="absolute inset-0 overflow-hidden">{children}</div>
        </ResultVizSizeContext.Provider>
      </div>
    </div>
  );
}

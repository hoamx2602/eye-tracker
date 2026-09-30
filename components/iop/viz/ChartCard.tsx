'use client';

import React from 'react';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/** Frame shared by the measurement charts. */
export default function ChartCard({ title, subtitle, children }: ChartCardProps) {
  return (
    <section className="rounded-lg border border-slate-700/80 bg-slate-900/60 p-4 space-y-3">
      <header>
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        {subtitle && <p className="text-xs leading-5 text-slate-400 mt-0.5">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

/** Legend key: a short mark in the series colour beside text-token text. */
export function LegendKey({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-300">
      <span
        className="inline-block w-4"
        style={{ borderTop: `2px solid ${colour}` }}
        aria-hidden
      />
      {label}
    </span>
  );
}

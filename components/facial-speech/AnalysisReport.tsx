'use client';

import {
  asSpeechSeries,
  asTrialAggregate,
  isSideMeasure,
  isUpperLowerComparison,
  type FaceMetricValue,
  type FacialSpeechReport,
  type SideMeasure,
} from '@/lib/facialSpeechBackend';
import { EnvelopeChart, PitchContourChart, SideLegend, SideTraceChart, SIDE_COLOR } from './charts';

const FACE_TASK_TITLES: Record<string, string> = {
  face_smile_show_teeth: 'Smile / show teeth',
  face_brow_raise: 'Brow raise',
  face_eye_closure: 'Eye closure',
};

const KEY_FRAME_TITLES: Record<string, string> = {
  rest: 'At rest (baseline)',
  smile_peak: 'Smile at peak',
  brow_peak: 'Brow raise at peak',
  eye_closed: 'Eyes at maximum closure',
};

const SPEECH_TASK_TITLES: Record<string, string> = {
  speech_sustained_a: 'Sustained vowel /a/',
  speech_ddk_patka: 'Diadochokinesis (pa-ta-ka)',
  speech_reading: 'NIHSS word list',
  speech_counting: 'Counting 1–20',
};

/** Metrics that already have their own charted section, so the summary grid
 * does not repeat them. */
const CHARTED_METRICS = new Set(['smile_excursion_ipd', 'brow_excursion_ipd', 'eye_closure_residual_ratio']);

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function fmt(value: number | null, digits = 2, unit = '') {
  return value === null ? '—' : `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

/** A number plus what it is. Used where a plot would be more chrome than signal. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-gray-800/70 px-3 py-2">
      <p className="text-[11px] leading-4 text-gray-500">{label}</p>
      <p className="mt-0.5 font-mono text-sm text-gray-100">{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] leading-4 text-gray-500">{hint}</p> : null}
    </div>
  );
}

/**
 * Left and right as opposed bars from a shared centre. Symmetry is then a
 * visual property — equal arms — rather than something the reader has to
 * compute from two numbers, and the weaker side is named in text so the
 * finding never rests on which bar looks shorter.
 */
function SideBars({ measure, unit }: { measure: SideMeasure; unit: string }) {
  const max = Math.max(measure.left ?? 0, measure.right ?? 0, 1e-6);
  const ratio = measure.ratio_weaker_over_stronger;
  return (
    <div>
      <div className="space-y-1.5">
        {(['left', 'right'] as const).map((side) => {
          const value = measure[side];
          return (
            <div key={side} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[11px] text-gray-400">{side === 'left' ? 'Left' : 'Right'}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-sm bg-gray-800">
                <div
                  className="h-full rounded-sm"
                  style={{ width: `${((value ?? 0) / max) * 100}%`, background: SIDE_COLOR[side] }}
                />
              </div>
              <span className="w-16 shrink-0 text-right font-mono text-[11px] text-gray-200">{fmt(value, 3)}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        Symmetry ratio <span className="font-mono text-gray-100">{fmt(ratio, 3)}</span>
        {unit ? <span className="text-gray-600"> · {unit}</span> : null}
        {measure.weaker_side ? <span className="text-amber-300"> · reduced on the {measure.weaker_side}</span> : null}
      </p>
    </div>
  );
}

function MetricRow({ name, value }: { name: string; value: FaceMetricValue }) {
  const label = name.replace(/_/g, ' ');
  if (isUpperLowerComparison(value)) {
    return (
      <div className="rounded-lg bg-gray-800/70 px-3 py-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs text-gray-400">{label}</span>
          <span className="font-mono text-sm text-gray-100">{fmt(value.symmetry_gap, 3)}</span>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-gray-500">
          Upper-face symmetry minus lower-face symmetry
          {value.same_weaker_side === null ? '' : value.same_weaker_side ? ', same side affected' : ', opposite sides affected'}. Reported
          without a cut-off: turning this into a pattern label needs the validation study.
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-lg bg-gray-800/70 px-3 py-2">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="font-mono text-sm text-gray-100">
        {typeof value === 'number' ? value.toFixed(4) : typeof value === 'string' ? value : '—'}
      </span>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-base font-semibold text-gray-100">{title}</h3>
      {subtitle ? <p className="mt-1 text-xs leading-5 text-gray-500">{subtitle}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SustainedVowelPanel({ task }: { task: Record<string, unknown> }) {
  const series = asSpeechSeries(task.series);
  const f0 = asTrialAggregate(task.f0_hz_median);
  const hnr = asTrialAggregate(task.hnr_db_median);
  const jitter = asTrialAggregate(task.jitter_local);
  const shimmer = asTrialAggregate(task.shimmer_local);
  const trials = f0?.n_trials ?? 0;
  const spread = trials > 1 ? `IQR across ${trials} trials` : undefined;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="F0 median" value={fmt(f0?.median ?? null, 1, 'Hz')} hint={spread && `IQR ${fmt(f0?.iqr ?? null, 1)}`} />
        <Stat label="HNR" value={fmt(hnr?.median ?? null, 1, 'dB')} hint={spread && `IQR ${fmt(hnr?.iqr ?? null, 1)}`} />
        <Stat label="Jitter (local)" value={fmt(jitter?.median ? jitter.median * 100 : null, 2, '%')} />
        <Stat label="Shimmer (local)" value={fmt(shimmer?.median ? shimmer.median * 100 : null, 2, '%')} />
        <Stat label="Max phonation" value={fmt(num(task.max_phonation_time_s), 1, 's')} />
      </div>
      <p className="mt-3 text-[11px] leading-4 text-gray-500">
        Perturbation measures are taken from the trimmed steady middle of each phonation and reported as a median across{' '}
        {trials || 0} trial(s). No reference range is applied — published thresholds assume a controlled recording setup this capture has
        not been validated against.
      </p>
      {series ? (
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-1 text-xs font-medium text-gray-300">Energy envelope and detected phonations</p>
            <EnvelopeChart envelope={series.envelope} gate={series.gate} trials={series.trials_s} durationS={series.duration_s} />
          </div>
          {series.f0?.length ? (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-300">Pitch contour per phonation</p>
              <p className="mb-1 text-[11px] text-gray-500">Gaps are unvoiced frames. A drifting or broken line is what an SD cannot show.</p>
              <PitchContourChart contours={series.f0} />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function DdkPanel({ task }: { task: Record<string, unknown> }) {
  const series = asSpeechSeries(task.series);
  const rate = asTrialAggregate(task.energy_peak_rate_hz);
  const cv = asTrialAggregate(task.peak_interval_cv);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Energy-peak rate" value={fmt(rate?.median ?? null, 2, '/s')} hint={`median of ${rate?.n_trials ?? 0} run(s)`} />
        <Stat label="Timing CV" value={fmt(cv?.median ?? null, 3)} hint="lower is more regular" />
        <Stat label="Usable runs" value={String(num(task.usable_runs) ?? '—')} />
      </div>
      <p className="mt-3 text-[11px] leading-4 text-gray-500">
        A proxy for syllable rate, not a syllable count: the unvoiced stop closures in pa-ta-ka do not always produce a separate energy
        peak. Do not read it against published DDK norms.
      </p>
      {series ? (
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-gray-300">Energy envelope and detected runs</p>
          <EnvelopeChart envelope={series.envelope} gate={series.gate} trials={series.trials_s} durationS={series.duration_s} />
        </div>
      ) : null}
    </>
  );
}

function ConnectedSpeechPanel({ task }: { task: Record<string, unknown> }) {
  const series = asSpeechSeries(task.series);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Speech rate" value={fmt(num(task.speech_rate_syllables_per_s), 2, '/s')} hint="includes pauses" />
        <Stat label="Articulation rate" value={fmt(num(task.articulation_rate_syllables_per_s), 2, '/s')} hint="excludes pauses" />
        <Stat label="Speaking-time ratio" value={fmt(num(task.speaking_time_ratio) !== null ? num(task.speaking_time_ratio)! * 100 : null, 0, '%')} />
        <Stat label="Pauses" value={String(num(task.pause_count) ?? '—')} />
        <Stat label="Median pause" value={fmt(num(task.pause_duration_s_median), 2, 's')} />
        <Stat label="F0 median" value={fmt(num(task.f0_hz_median), 1, 'Hz')} />
      </div>
      <p className="mt-3 text-[11px] leading-4 text-gray-500">
        Two subjects can share a speech rate while one pauses heavily and the other articulates slowly; only the second is a
        motor-speech finding.{' '}
        {task.rate_basis
          ? 'Rates use the syllable count declared with the prompt and assume it was read as given — a misread or skipped word shifts them.'
          : 'No rate is shown because the prompt declares no syllable count.'}
      </p>
      {series ? (
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-gray-300">Energy envelope and phonation segments</p>
          <EnvelopeChart envelope={series.envelope} gate={series.gate} trials={series.trials_s} durationS={series.duration_s} />
        </div>
      ) : null}
    </>
  );
}

export function AnalysisReport({ report }: { report: FacialSpeechReport }) {
  const keyFrames = Object.entries(report.face.key_frames ?? {});
  const faceSeries = Object.entries(report.face.series ?? {});
  // Everything that does not already have its own charted section above.
  const otherMetrics = Object.entries(report.face.metrics ?? {}).filter(([name]) => !CHARTED_METRICS.has(name));

  return (
    <div className="space-y-5">
      <div
        className={`rounded-2xl border p-4 ${
          report.quality.passed ? 'border-emerald-900 bg-emerald-950/30' : 'border-amber-800 bg-amber-950/30'
        }`}
      >
        <p className={`text-sm font-semibold ${report.quality.passed ? 'text-emerald-100' : 'text-amber-100'}`}>
          {report.quality.passed ? 'Capture quality passed' : 'Insufficient capture quality — no score reported'}
        </p>
        {report.quality.issues?.length ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-100/90">
            {report.quality.issues.map((issue) => (
              <li key={`${issue.code}:${issue.scope}`}>
                <span className="font-mono text-[11px] opacity-70">{issue.scope}</span> — {issue.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-emerald-100/80">Face visibility, illumination, blur, head pose, task-window and audio gates all passed.</p>
        )}
      </div>

      {keyFrames.length ? (
        <Section
          title="What was measured"
          subtitle="Each still is the frame the summary was taken from. The grey lines are the facial midline and interocular line the geometry is expressed in; the arrows are the mouth-corner displacement whose length is the excursion figure."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {keyFrames.map(([name, source]) => (
              <figure key={name} className="overflow-hidden rounded-lg border border-gray-800 bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={source} alt={KEY_FRAME_TITLES[name] ?? name} className="w-full" />
                <figcaption className="px-2 py-1.5 text-[11px] text-gray-400">{KEY_FRAME_TITLES[name] ?? name}</figcaption>
              </figure>
            ))}
          </div>
          <div className="mt-3">
            <SideLegend />
          </div>
        </Section>
      ) : null}

      {report.face.available ? (
        <>
          {faceSeries.map(([taskId, series]) => {
            const metricKey =
              taskId === 'face_smile_show_teeth'
                ? 'smile_excursion_ipd'
                : taskId === 'face_brow_raise'
                  ? 'brow_excursion_ipd'
                  : 'eye_closure_residual_ratio';
            const measure = report.face.metrics[metricKey];
            return (
              <Section key={taskId} title={FACE_TASK_TITLES[taskId] ?? taskId} subtitle={series.label}>
                <div className="grid gap-5 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
                  <div>{isSideMeasure(measure) ? <SideBars measure={measure} unit={series.unit} /> : null}</div>
                  <div>
                    <SideTraceChart tMs={series.t_ms} left={series.left} right={series.right} unit={series.unit} peakTMs={series.peak_t_ms} />
                    <div className="mt-2 flex items-center justify-between">
                      <SideLegend />
                      <span className="text-[11px] text-gray-500">{series.t_ms.length} frames</span>
                    </div>
                  </div>
                </div>
              </Section>
            );
          })}

          <Section title="Other facial measurements">
            <div className="grid gap-2 sm:grid-cols-2">
              {otherMetrics.map(([name, value]) =>
                isSideMeasure(value) ? (
                  <div key={name} className="rounded-lg bg-gray-800/70 p-3">
                    <p className="mb-2 text-xs text-gray-400">{name.replace(/_/g, ' ')}</p>
                    <SideBars measure={value} unit="" />
                  </div>
                ) : (
                  <MetricRow key={name} name={name} value={value} />
                ),
              )}
            </div>
          </Section>
        </>
      ) : (
        <Section title="Facial movement measurements">
          <p className="rounded-lg bg-gray-800/70 p-3 text-sm leading-6 text-amber-200">
            Withheld. The video did not meet the measurement gates above, and a partial result from an unusable capture is worse than
            none. Re-capture rather than interpreting what survived.
          </p>
        </Section>
      )}

      {Object.entries(report.speech.tasks ?? {}).map(([taskId, task]) => (
        <Section key={taskId} title={SPEECH_TASK_TITLES[taskId] ?? taskId}>
          {task.available === false ? (
            <p className="rounded-lg bg-gray-800/70 p-3 text-sm leading-6 text-amber-200">
              Withheld — this window did not pass the audio gates listed above.
            </p>
          ) : taskId === 'speech_sustained_a' ? (
            <SustainedVowelPanel task={task} />
          ) : taskId === 'speech_ddk_patka' ? (
            <DdkPanel task={task} />
          ) : (
            <ConnectedSpeechPanel task={task} />
          )}
        </Section>
      ))}

      <p className="rounded-2xl border border-gray-800 bg-gray-900 p-4 text-xs leading-5 text-gray-500">
        {report.interpretation}. Report {report.version}, status {report.status}.
      </p>
    </div>
  );
}

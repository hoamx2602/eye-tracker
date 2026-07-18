"""
Generate an offline gaze replay/debug HTML.

Usage:
    python3 -m app.replay --video /data/session.webm --meta /data/session.meta.json \
      --report /data/report.json --out /data/offline-replay.html

The report should be produced with:
    python3 -m app.reprocess ... --include-trace --out /data/report.json
"""
from __future__ import annotations

import argparse
import json
import os
from html import escape
from pathlib import Path


def _json_for_script(obj: object) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/")


def _rel(from_file: str, target: str) -> str:
    return os.path.relpath(Path(target).resolve(), Path(from_file).resolve().parent).replace("\\", "/")


def render(video_path: str, meta_path: str, report_path: str, out_path: str) -> None:
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    with open(report_path, encoding="utf-8") as f:
        report = json.load(f)

    trace = report.get("debug_trace")
    if not isinstance(trace, list) or not trace:
        raise SystemExit(
            "report.json has no debug_trace. Re-run app.reprocess with --include-trace."
        )

    video_src = escape(_rel(out_path, video_path))
    meta_js = _json_for_script(meta)
    report_js = _json_for_script(report)

    html = f"""<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline gaze replay</title>
<style>
  :root {{
    color-scheme: dark;
    --bg:#090d16; --panel:#111827; --panel2:#0f172a; --text:#e5e7eb;
    --muted:#94a3b8; --line:#334155; --good:#22c55e; --warn:#f59e0b;
    --bad:#ef4444; --gaze:#38bdf8; --target:#a78bfa;
  }}
  * {{ box-sizing:border-box; }}
  body {{
    margin:0; background:var(--bg); color:var(--text);
    font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  }}
  header {{ padding:16px 20px; border-bottom:1px solid var(--line); background:#0b1020; }}
  h1 {{ margin:0 0 6px; font-size:18px; font-weight:600; }}
  .sub {{ color:var(--muted); font-size:13px; }}
  .wrap {{ display:grid; grid-template-columns: minmax(320px, 0.95fr) minmax(380px, 1.05fr); gap:14px; padding:14px; }}
  .panel {{ background:var(--panel); border:1px solid var(--line); border-radius:14px; overflow:hidden; }}
  .panel h2 {{ margin:0; padding:10px 12px; font-size:14px; font-weight:600; border-bottom:1px solid var(--line); }}
  video {{ width:100%; display:block; background:#000; }}
  .screenBox {{ padding:10px; }}
  canvas {{ width:100%; aspect-ratio:16/9; display:block; border-radius:10px; background:#020617; border:1px solid var(--line); }}
  .controls {{ display:flex; gap:10px; align-items:center; padding:10px 14px; border-top:1px solid var(--line); flex-wrap:wrap; }}
  input[type=range] {{ flex:1; min-width:260px; }}
  button {{ background:#1f2937; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:7px 10px; cursor:pointer; }}
  button:hover {{ background:#273449; }}
  .grid {{ display:grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap:10px; padding:14px; }}
  .stat {{ background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:10px; }}
  .label {{ color:var(--muted); font-size:12px; }}
  .value {{ font-size:18px; font-weight:600; margin-top:3px; }}
  .row {{ display:grid; grid-template-columns: 1fr 1fr; gap:14px; padding:0 14px 14px; }}
  table {{ width:100%; border-collapse:collapse; font-size:12px; }}
  th,td {{ padding:6px 7px; border-bottom:1px solid var(--line); text-align:left; }}
  th {{ color:var(--muted); font-weight:500; }}
  .legend {{ display:flex; gap:14px; color:var(--muted); font-size:12px; padding:0 12px 10px; flex-wrap:wrap; }}
  .sw {{ display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:5px; vertical-align:-1px; }}
  @media (max-width: 900px) {{
    .wrap, .row {{ grid-template-columns:1fr; }}
    .grid {{ grid-template-columns: repeat(2, minmax(120px, 1fr)); }}
  }}
</style>
<header>
  <h1>Offline gaze replay</h1>
  <div class="sub">Left = recorded webcam video. Right = backend's timestamp-aligned screen-space gaze after offline inference, calibration, quality gate, and head compensation.</div>
</header>
<main>
  <section class="wrap">
    <div class="panel">
      <h2>Recorded video</h2>
      <video id="vid" src="{video_src}" controls preload="metadata"></video>
      <div class="controls">
        <button id="back" type="button">−1 frame</button>
        <button id="fwd" type="button">+1 frame</button>
        <span id="clock" class="label">0.000s</span>
      </div>
    </div>
    <div class="panel">
      <h2>Backend gaze on screen</h2>
      <div class="screenBox"><canvas id="screen"></canvas></div>
      <div class="legend">
        <span><i class="sw" style="background:var(--gaze)"></i>gaze</span>
        <span><i class="sw" style="background:var(--target)"></i>active target window</span>
        <span><i class="sw" style="background:var(--bad)"></i>missing/quality-gated gaze</span>
      </div>
      <div class="controls">
        <input id="seek" type="range" min="0" max="0" step="1" value="0" aria-label="trace frame">
        <span id="idx" class="label">frame 0</span>
      </div>
    </div>
  </section>
  <section class="grid">
    <div class="stat"><div class="label">validation error</div><div class="value" id="valErr">—</div></div>
    <div class="stat"><div class="label">raw no-comp</div><div class="value" id="rawErr">—</div></div>
    <div class="stat"><div class="label">gaze quality</div><div class="value" id="quality">—</div></div>
    <div class="stat"><div class="label">head motion p95</div><div class="value" id="head">—</div></div>
  </section>
  <section class="row">
    <div class="panel"><h2>Current frame</h2><div class="grid" id="frameStats"></div></div>
    <div class="panel"><h2>Validation points</h2><div style="padding:8px 12px"><table id="valTable"></table></div></div>
  </section>
</main>
<script>
const META = {meta_js};
const REPORT = {report_js};
const TRACE = REPORT.debug_trace;
const W = META.screen.width_px, H = META.screen.height_px;
const dots = [
  ...(META.calibration_dots || []).map((d,i)=>({{...d, kind:'calibration', i}})),
  ...(META.validation_dots || []).map((d,i)=>({{...d, kind:'validation', i}})),
];
const vid = document.getElementById('vid');
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const seek = document.getElementById('seek');
const clock = document.getElementById('clock');
const idxEl = document.getElementById('idx');
const val = REPORT.validation || null;
document.getElementById('valErr').textContent = val && isFinite(val.overall_deg) ? val.overall_deg.toFixed(2) + '°' : '—';
document.getElementById('rawErr').textContent = val && isFinite(val.overall_deg_raw) ? val.overall_deg_raw.toFixed(2) + '°' : '—';
document.getElementById('head').textContent = REPORT.head && REPORT.head.motion && isFinite(REPORT.head.motion.lateral_p95_cm) ? REPORT.head.motion.lateral_p95_cm.toFixed(1) + ' cm' : '—';
seek.max = Math.max(0, TRACE.length - 1);

function nearestIndex(tMs) {{
  let lo = 0, hi = TRACE.length - 1;
  while (lo < hi) {{
    const mid = (lo + hi) >> 1;
    if (TRACE[mid].t < tMs) lo = mid + 1; else hi = mid;
  }}
  if (lo > 0 && Math.abs(TRACE[lo-1].t - tMs) < Math.abs(TRACE[lo].t - tMs)) return lo - 1;
  return lo;
}}
function sx(x) {{ return x / W * canvas.width; }}
function sy(y) {{ return y / H * canvas.height; }}
function drawGrid() {{
  ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
  for (let i=1;i<4;i++) {{
    ctx.beginPath(); ctx.moveTo(i*canvas.width/4,0); ctx.lineTo(i*canvas.width/4,canvas.height); ctx.stroke();
  }}
  for (let i=1;i<3;i++) {{
    ctx.beginPath(); ctx.moveTo(0,i*canvas.height/3); ctx.lineTo(canvas.width,i*canvas.height/3); ctx.stroke();
  }}
}}
function drawDot(d, active) {{
  ctx.beginPath();
  ctx.arc(sx(d.screen_x), sy(d.screen_y), active ? 11 : 6, 0, Math.PI*2);
  ctx.fillStyle = active ? 'rgba(167,139,250,.9)' : (d.kind === 'validation' ? 'rgba(245,158,11,.45)' : 'rgba(148,163,184,.28)');
  ctx.fill();
  ctx.strokeStyle = active ? '#ddd6fe' : '#64748b';
  ctx.stroke();
}}
function draw(i) {{
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(640, Math.floor(rect.width * dpr));
  canvas.height = Math.floor(canvas.width * H / W);
  const fr = TRACE[i];
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#020617'; ctx.fillRect(0,0,canvas.width,canvas.height);
  drawGrid();
  const t = fr.t;
  for (const d of dots) drawDot(d, t >= d.t_start_ms && t <= d.t_end_ms);
  const tail = [];
  for (let j=Math.max(0,i-45); j<=i; j++) if (TRACE[j].x != null && TRACE[j].y != null) tail.push(TRACE[j]);
  ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(56,189,248,.55)';
  ctx.beginPath();
  tail.forEach((p,k)=>{{ if(k===0) ctx.moveTo(sx(p.x),sy(p.y)); else ctx.lineTo(sx(p.x),sy(p.y)); }});
  ctx.stroke();
  if (fr.x != null && fr.y != null) {{
    ctx.beginPath(); ctx.arc(sx(fr.x), sy(fr.y), 8, 0, Math.PI*2);
    ctx.fillStyle = '#38bdf8'; ctx.fill();
    ctx.strokeStyle = '#e0f2fe'; ctx.stroke();
  }} else {{
    ctx.fillStyle = 'rgba(239,68,68,.9)';
    ctx.fillRect(12, 12, 120, 28);
    ctx.fillStyle = '#fee2e2';
    ctx.fillText('missing gaze', 22, 31);
  }}
  seek.value = String(i);
  idxEl.textContent = `frame ${{i+1}} / ${{TRACE.length}}`;
  clock.textContent = (t/1000).toFixed(3) + 's';
  document.getElementById('quality').textContent = fr.q == null ? '—' : Math.round(fr.q * 100) + '%';
  document.getElementById('frameStats').innerHTML = [
    ['t', (t/1000).toFixed(3) + 's'],
    ['x,y', fr.x == null ? 'missing' : Math.round(fr.x)+', '+Math.round(fr.y)],
    ['yaw,pitch', fr.yaw == null ? 'missing' : (fr.yaw*180/Math.PI).toFixed(1)+'°, '+(fr.pitch*180/Math.PI).toFixed(1)+'°'],
    ['head u/v/w', fr.hu == null ? 'missing' : fr.hu.toFixed(3)+' / '+fr.hv.toFixed(3)+' / '+fr.hw.toFixed(3)]
  ].map(([a,b])=>`<div class="stat"><div class="label">${{a}}</div><div class="value">${{b}}</div></div>`).join('');
}}
function syncFromVideo() {{ draw(nearestIndex(vid.currentTime * 1000)); }}
vid.addEventListener('timeupdate', syncFromVideo);
vid.addEventListener('seeked', syncFromVideo);
seek.addEventListener('input', () => {{
  const i = Number(seek.value);
  vid.currentTime = TRACE[i].t / 1000;
  draw(i);
}});
document.getElementById('back').onclick = () => {{
  const i = Math.max(0, Number(seek.value) - 1);
  vid.currentTime = TRACE[i].t / 1000; draw(i);
}};
document.getElementById('fwd').onclick = () => {{
  const i = Math.min(TRACE.length - 1, Number(seek.value) + 1);
  vid.currentTime = TRACE[i].t / 1000; draw(i);
}};
function fillValTable() {{
  const pts = val && Array.isArray(val.per_point) ? val.per_point : [];
  const rows = ['<tr><th>#</th><th>region</th><th>target</th><th>pred</th><th>error</th><th>q</th></tr>'];
  pts.forEach((p,i)=>rows.push(`<tr><td>${{i+1}}</td><td>${{p.region||''}}</td><td>${{Math.round(p.screen_x)}},${{Math.round(p.screen_y)}}</td><td>${{Math.round(p.pred_x)}},${{Math.round(p.pred_y)}}</td><td>${{p.error_deg.toFixed(2)}}°</td><td>${{Math.round((p.quality||0)*100)}}%</td></tr>`));
  if (!pts.length) rows.push('<tr><td colspan="6">No validation_dots/per_point in report.</td></tr>');
  document.getElementById('valTable').innerHTML = rows.join('');
}}
fillValTable();
draw(0);
</script>
"""
    Path(out_path).write_text(html, encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate an offline gaze replay HTML.")
    ap.add_argument("--video", required=True)
    ap.add_argument("--meta", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    render(args.video, args.meta, args.report, args.out)
    print(f"Wrote replay -> {args.out}")


if __name__ == "__main__":
    main()

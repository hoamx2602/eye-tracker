import Link from 'next/link';
import { MODULE_PATHS } from '@/lib/paths';
import { Arrow } from './LandingIcons';
import styles from './Landing.module.css';

const modules = [
  { href: MODULE_PATHS.EYE_TRACKING, title: 'Eye tracking', category: 'NEUROLOGICAL ASSESSMENT', description: 'Guided exercises to explore eye movements, gaze and attention.', device: 'Webcam', kind: 'gaze' },
  { href: MODULE_PATHS.FACIAL_DROOP, title: 'Facial droop', category: 'FACIAL MOVEMENT & MOTOR SPEECH', description: 'Guided facial and speech tasks to explore symmetry and articulation.', device: 'Camera + microphone', kind: 'face' },
  { href: MODULE_PATHS.IOP, title: 'IOP risk', category: 'FRONTAL EYE IMAGE ANALYSIS', description: 'Explore pupil, iris and sclera features from a close-up eye photo.', device: 'Photo upload', kind: 'iris' },
] as const;

function ModuleArt({ kind }: { kind: typeof modules[number]['kind'] }) {
  return <svg className={styles.moduleArt} viewBox="0 0 360 220" fill="none" aria-hidden="true">
    <path d="M22 38V22h16m284 16V22h-16M22 182v16h16m284-16v16h-16" stroke="currentColor" opacity=".25" />
    {kind === 'gaze' && <>
      <path d="M45 110Q180-17 315 110Q180 237 45 110Z" stroke="currentColor" opacity=".3" />
      <path d="M62 110Q180 8 298 110Q180 212 62 110Z" stroke="currentColor" opacity=".15" />
      <g className={styles.gazeArt}><circle cx="180" cy="110" r="45" stroke="currentColor" /><circle cx="180" cy="110" r="31" stroke="currentColor" strokeDasharray="1 4" strokeWidth="8" /><circle cx="180" cy="110" r="16" fill="currentColor" opacity=".7" /><circle cx="186" cy="104" r="4" fill="#fff" /></g>
      <path d="M66 160l51-63 70 33 63-75 47 19" stroke="currentColor" opacity=".5" strokeDasharray="3 5" />
      {[[66,160],[117,97],[187,130],[250,55],[297,74]].map(([x,y]) => <circle key={x} cx={x} cy={y} r="3" fill="currentColor" />)}
    </>}
    {kind === 'face' && <>
      <path d="M180 27c-39 0-61 29-59 72l7 42c6 26 35 52 52 52s46-26 52-52l7-42c2-43-20-72-59-72Z" stroke="currentColor" opacity=".55" />
      <path d="m130 87 26-11 24 16 24-16 26 11-26 19-24-14-24 14-26-19Zm-2 54 33-14 19 11 19-11 33 14-31 24h-42l-31-24Zm28-65 5 51m43-51-5 51M180 27v166m-52-52 28-35m76 35-28-35m-43 21 19-35 19 35" stroke="currentColor" opacity=".25" />
      <path d="M142 98q13-8 25 0m26 0q13-8 25 0m-58 55q20 15 40 0m-20-48-6 24h12" stroke="currentColor" strokeWidth="1.6" />
      {[[180,27],[130,87],[156,76],[204,76],[230,87],[156,106],[204,106],[180,92],[161,127],[199,127],[128,141],[232,141],[159,165],[201,165],[180,193]].map(([x,y],i) => <circle key={i} cx={x} cy={y} r="2.5" fill="currentColor" />)}
      <path className={styles.scanArt} d="M90 110h180" stroke="currentColor" opacity=".55" />
    </>}
    {kind === 'iris' && <>
      <circle cx="180" cy="110" r="78" stroke="currentColor" opacity=".2" /><circle cx="180" cy="110" r="64" stroke="currentColor" opacity=".4" />
      <g className={styles.irisArt}>{Array.from({ length: 72 }, (_, i) => <path key={i} d={`M ${180 + Math.cos(i * Math.PI / 36) * 31} ${110 + Math.sin(i * Math.PI / 36) * 31} L ${180 + Math.cos(i * Math.PI / 36 + .04) * (55 + i % 7)} ${110 + Math.sin(i * Math.PI / 36 + .04) * (55 + i % 7)}`} stroke="currentColor" opacity={.3 + (i % 4) * .15} />)}</g>
      <circle cx="180" cy="110" r="25" fill="currentColor" opacity=".8" /><circle cx="188" cy="102" r="5" fill="#fff" opacity=".8" />
      <path d="M83 110h39m116 0h39M180 14v28m0 136v28m-28-85 10-11-10-11m56 22-10-11 10-11" stroke="currentColor" opacity=".4" />
    </>}
  </svg>;
}

export default function AssessmentCards() {
  return <div className={styles.cards}>
    {modules.map((module) => <Link href={module.href} key={module.href} className={styles.card} data-kind={module.kind} data-reveal>
      <div className={styles.cardVisual}><ModuleArt kind={module.kind} /></div>
      <div className={styles.cardContent}><p className={styles.cardCategory}>{module.category}</p><h3>{module.title}</h3><p className={styles.cardDescription}>{module.description}</p><div className={styles.cardFoot}><span>{module.device}</span><span className={styles.cardArrow}><Arrow /></span></div></div>
    </Link>)}
  </div>;
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MODULE_PATHS } from '@/lib/paths';
import EyeVisual from './landing/EyeVisual';
import AssessmentCards from './landing/AssessmentCards';
import { Arrow, EyeMark } from './landing/LandingIcons';
import styles from './landing/Landing.module.css';

export default function ModuleHub() {
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [neural, setNeural] = useState(true);

  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.setAttribute('data-visible', 'true');
          observer.unobserve(entry.target);
        }
      });
    }, { root: container, threshold: 0.12 });
    container.querySelectorAll('[data-reveal]').forEach((element) => {
      element.setAttribute('data-visible', 'false');
      observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={root} className={styles.landing} data-paused={paused} data-landing-scroll>
      <a className={styles.skipLink} href="#assessments">Skip to assessments</a>
      <main>
        <section id="landing-top" className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroStage}>
          <div className={styles.ambientLight} aria-hidden="true" />
          <div className={styles.heroWordmark} aria-hidden="true">neurotree</div>
          <header className={styles.header}>
            <Link href={MODULE_PATHS.HUB} className={styles.brand} aria-label="neurotree home"><EyeMark /><span>neurotree<span className={styles.brandDot}>.</span></span></Link>
            <nav className={styles.navigation} aria-label="Main navigation">
              <a href="#assessments">Assessments <Arrow /></a>
              <button className={styles.motionButton} aria-label={paused ? 'Play animation' : 'Pause animation'} title={paused ? 'Play animation' : 'Pause animation'} aria-pressed={paused} onClick={() => setPaused(!paused)}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{paused ? <path d="m9 5 10 7-10 7V5Z" /> : <path d="M9 5v14M15 5v14" />}</svg>
              </button>
            </nav>
          </header>
          <h1 id="hero-title" className={styles.srOnly}>neurotree — neurological assessments</h1>
          <EyeVisual paused={paused} neural={neural} />
          <div className={styles.heroAction}>
            <div className={styles.sceneModes} role="group" aria-label="Eye visualization">
              <button type="button" aria-pressed={!neural} onClick={() => setNeural(false)}><span aria-hidden="true">◎</span> Iris</button>
              <button type="button" aria-pressed={neural} onClick={() => setNeural(true)}><span aria-hidden="true">⠿</span> Neural</button>
            </div>
            <a href="#assessments" className={styles.primaryButton}>Explore assessments <Arrow /></a>
          </div>
          <span className={styles.interactionHint} aria-hidden="true">Move to connect. Click to illuminate.</span>
          </div>
        </section>
        <section id="assessments" tabIndex={-1} className={styles.assessments} aria-labelledby="assessments-title">
          <div className={styles.sectionHeading} data-reveal><h2 id="assessments-title">Choose your assessment<span>.</span></h2><p>Three ways to explore. One place to begin.</p></div>
          <AssessmentCards />
          <p className={styles.researchNote}>For research use only. Results are not a medical diagnosis.</p>
        </section>
      </main>
      <footer className={styles.footer}>
        <Link href={MODULE_PATHS.HUB} className={styles.footerBrand}>neurotree.</Link>
        <span>© {new Date().getFullYear()} Neurotree</span>
        <a href="#landing-top" aria-label="Back to top">↑</a>
      </footer>
    </div>
  );
}

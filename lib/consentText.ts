/**
 * The participant consent form, in both the form it is read in and the form it
 * is spoken in.
 *
 * The screen shows first person — "I understand that…" — because that is what
 * the participant is agreeing to, and a consent form has to read as their own
 * statement. Spoken aloud, first person is disorienting: a voice saying "I
 * agree to provide access to my camera" sounds like the computer consenting to
 * something. So each point carries both, written side by side.
 *
 * They are kept in one file, as pairs, deliberately. A mechanical I→you
 * rewrite at runtime would be a sentence-by-sentence gamble on possessives and
 * verb agreement, and nobody would ever see the result — this way the two
 * readings sit on adjacent lines where any drift between them is obvious.
 *
 * `lib/voice/scripts.ts` builds the spoken clip from `spoken`; ConsentModal
 * renders `written`.
 */

export interface ConsentPoint {
  /** First person, shown on screen. */
  written: string;
  /** Second person, spoken aloud. */
  spoken: string;
}

export interface ConsentSection {
  heading: string;
  points: ConsentPoint[];
}

export const CONSENT_SECTIONS: ConsentSection[] = [
  {
    heading: 'Study Purpose & Scope',
    points: [
      {
        written:
          'I understand that this system is part of a research project aimed at developing neurological assessment tools using eye-tracking technology.',
        spoken:
          'This system is part of a research project developing neurological assessment tools using eye-tracking technology.',
      },
      {
        written:
          'I am aware that my participation is voluntary and intended to contribute to the advancement of clinical and scientific knowledge.',
        spoken:
          'Your participation is voluntary, and is intended to contribute to clinical and scientific knowledge.',
      },
      {
        written:
          'I agree to provide access to my camera for the duration of this session to enable gaze tracking and performance monitoring.',
        spoken:
          'You are agreeing to give access to your camera for the duration of this session, so that your gaze and performance can be tracked.',
      },
    ],
  },
  {
    heading: 'Data Collection & Processing',
    points: [
      {
        written:
          'I acknowledge that my eye-movement data (coordinates) and video/image recordings of my face will be collected and processed.',
        spoken:
          'Your eye-movement coordinates, and video and image recordings of your face, will be collected and processed.',
      },
      {
        written:
          'I understand that these data are recorded for the purpose of refining calibration accuracy and verifying test performance.',
        spoken:
          'This is recorded in order to refine calibration accuracy and to verify test performance.',
      },
      {
        written:
          'I understand that all data are stored securely in UK-based, ISO 27001 certified data centers with SSL encryption, managed under the UK Data Protection Act 2018 (UK GDPR).',
        spoken:
          'All data is stored securely in United Kingdom data centres that are ISO 27001 certified, with encryption, and is managed under the UK Data Protection Act 2018.',
      },
    ],
  },
  {
    heading: 'Privacy & Anonymity',
    points: [
      {
        written:
          'I understand that while facial imagery is collected, it is strictly used for tracking optimization and will not be used for biometric identity verification or facial recognition purposes.',
        spoken:
          'Although images of your face are collected, they are used strictly to improve tracking. They will not be used for biometric identity verification or facial recognition.',
      },
      {
        written:
          'I understand that my data will be pseudonymized (associated with a unique ID rather than my name) and that access is restricted to the research team.',
        spoken:
          'Your data is pseudonymised — linked to a unique code rather than your name — and access is restricted to the research team.',
      },
    ],
  },
  {
    heading: 'Withdrawal & Rights',
    points: [
      {
        written:
          'I understand that I am free to withdraw from the study at any time, without giving any reason and without my legal rights being affected. To withdraw, I can simply close the browser window.',
        spoken:
          'You are free to withdraw from the study at any time, without giving a reason and without your legal rights being affected. To withdraw, simply close the browser window.',
      },
      {
        written:
          'I agree that anonymized data collected up to the point of withdrawal may still be used by the research team for analysis.',
        spoken:
          'You are agreeing that anonymised data collected up to the point of withdrawal may still be used by the research team for analysis.',
      },
    ],
  },
  {
    heading: 'Not a Medical Device',
    points: [
      {
        written:
          'I acknowledge that this tool is not a medical device and is not intended for the diagnosis or treatment of any medical condition. It is for health and wellness awareness and research purposes only.',
        spoken:
          'This tool is not a medical device, and is not intended to diagnose or treat any medical condition. It is for health and wellness awareness, and for research, only.',
      },
    ],
  },
];

export const CONSENT_CLOSING: ConsentPoint = {
  written:
    'By clicking "I agree", I confirm that I have read and understood the information above and freely consent to participate in this research study under the terms described.',
  spoken:
    'By selecting "I agree", you confirm that you have read and understood this information, and freely consent to take part in this research study under the terms described.',
};

/**
 * The whole form as one spoken passage.
 *
 * Headings are spoken too — without them, twelve statements in a row are
 * impossible to keep track of by ear.
 */
export function consentSpokenText(): string {
  const parts: string[] = [];
  for (const section of CONSENT_SECTIONS) {
    parts.push(`${section.heading}.`);
    for (const point of section.points) parts.push(point.spoken);
  }
  parts.push(CONSENT_CLOSING.spoken);
  return parts.join(' ');
}

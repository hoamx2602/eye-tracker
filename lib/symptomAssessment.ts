/**
 * Pre/Post symptom assessment: 12 questions (Q1–Q12), scale 0–4.
 * Ref: Neurological_Experiments.pdf — Pre and Post Symptom Assessment
 */

export const SYMPTOM_SCALE_LABELS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Mild' },
  { value: 2, label: 'Moderate' },
  { value: 3, label: 'Strong' },
  { value: 4, label: 'Severe' },
] as const;

export type SymptomScoreValue = 0 | 1 | 2 | 3 | 4;

export type SymptomScores = Record<string, number>;

export const SYMPTOM_QUESTION_IDS = [
  'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6',
  'Q7', 'Q8', 'Q9', 'Q10', 'Q11', 'Q12',
] as const;

export type SymptomQuestionId = (typeof SYMPTOM_QUESTION_IDS)[number];

export interface SymptomQuestion {
  id: SymptomQuestionId;
  category: string;
  question: string;
}

export const SYMPTOM_QUESTIONS: SymptomQuestion[] = [
  { id: 'Q1', category: 'Headache', question: 'Do you feel any headache or head pressure now?' },
  { id: 'Q2', category: 'Dizziness', question: 'Do you feel dizzy or lightheaded?' },
  { id: 'Q3', category: 'Nausea', question: 'Do you feel nauseous?' },
  { id: 'Q4', category: 'Vision Clarity', question: 'Is your vision blurry or less clear than normal?' },
  { id: 'Q5', category: 'Eye Strain', question: 'Do your eyes feel tired or strained?' },
  { id: 'Q6', category: 'Visual Focus', question: 'Do you have difficulty focusing your eyes?' },
  { id: 'Q7', category: 'Light Sensitivity', question: 'Are you sensitive to light?' },
  { id: 'Q8', category: 'Concentration', question: 'Do you have difficulty concentrating?' },
  { id: 'Q9', category: 'Mental Fatigue', question: 'Do you feel mentally fatigued?' },
  { id: 'Q10', category: 'Neck Condition', question: 'Do you feel neck pain or stiffness?' },
  { id: 'Q11', category: 'Double Vision', question: 'Do you see double images (double vision)?' },
  { id: 'Q12', category: 'Balance', question: 'Do you feel unsteady or have difficulty maintaining balance?' },
];

export const SYMPTOM_INSTRUCTION_PRE = 'Before we start the neurological tests, please rate how you feel right now.';
export const SYMPTOM_INSTRUCTION_POST = 'Now that the test session is finished, please rate how you feel.';
export const SYMPTOM_SCALE_LEGEND = 'Scale: 0 = None | 1 = Mild | 2 = Moderate | 3 = Strong | 4 = Severe';

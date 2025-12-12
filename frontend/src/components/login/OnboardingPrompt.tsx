'use client';

import { useMemo } from 'react';

export interface OnboardingQuestion {
  id: string;
  label: string;
  placeholder?: string;
  helperText?: string;
}

interface OnboardingPromptProps {
  questions: OnboardingQuestion[];
  currentStep: number;
  responses: Record<string, string>;
  onResponseChange: (id: string, value: string) => void;
  onBack: () => void;
  onNext: () => void;
  onFinish: () => void;
}

export function OnboardingPrompt({
  questions,
  currentStep,
  responses,
  onResponseChange,
  onBack,
  onNext,
  onFinish
}: OnboardingPromptProps) {
  const currentQuestion = questions[currentStep];
  const progress = useMemo(() => ((currentStep + 1) / questions.length) * 100, [currentStep, questions.length]);
  const isLastStep = currentStep === questions.length - 1;

  if (!currentQuestion) return null;

  return (
    <div className="onboarding-card">
      <div className="onboarding-progress">
        <div className="onboarding-progress-value" style={{ width: `${progress}%` }} />
      </div>
      <p className="onboarding-step">
        Step {currentStep + 1} of {questions.length}
      </p>
      <h2>{currentQuestion.label}</h2>
      {currentQuestion.helperText && <p className="text-muted">{currentQuestion.helperText}</p>}
      <input
        type="text"
        className="onboarding-input"
        placeholder={currentQuestion.placeholder}
        value={responses[currentQuestion.id] ?? ''}
        onChange={(event) => onResponseChange(currentQuestion.id, event.target.value)}
      />
      <div className="onboarding-actions">
        <button type="button" className="onboarding-btn secondary" onClick={onBack} disabled={currentStep === 0}>
          Back
        </button>
        <button type="button" className="onboarding-btn primary" onClick={isLastStep ? onFinish : onNext}>
          {isLastStep ? 'Finish' : 'Next'}
        </button>
      </div>
    </div>
  );
}

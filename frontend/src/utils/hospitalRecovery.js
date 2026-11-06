/** Advance only a settled hospital day; a failed request must wait for an explicit retry. */
export function shouldAdvanceHospitalDay({
  turn, status, loading, error, turnLoadError, pendingTurnNumber, pendingEvents,
  surgeResults, surgePromptPending, faintEvent, activeModal,
  tutorialStep, firstDayStep, quantTourStep,
}) {
  return Boolean(status === 'active' && turn?.actionLocked && !loading && !error && !turnLoadError &&
    pendingTurnNumber === null && pendingEvents.length === 0 && surgeResults.length === 0 &&
    !surgePromptPending && !faintEvent && !activeModal && tutorialStep === null &&
    firstDayStep === null && quantTourStep === null);
}

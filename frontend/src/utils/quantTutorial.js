export const QUANT_TOUR_TURN = 11;

/** Start once the day's required actions and any open screen have been resolved. */
export function shouldStartQuantTour({
  turn, loading, pendingTurnNumber, pendingEvents, surgeResults, surgePromptPending,
  faintEvent, activeModal, tutorialStep, firstDayStep, quantTourStep, tutorialProgress,
}) {
  return Boolean(turn && turn.turnNumber >= QUANT_TOUR_TURN &&
    !turn.isRepaymentTurn && !turn.actionLocked && !loading && pendingTurnNumber === null &&
    pendingEvents.length === 0 && surgeResults.length === 0 && !surgePromptPending && !faintEvent &&
    !activeModal && tutorialStep === null && firstDayStep === null && quantTourStep === null &&
    tutorialProgress.welcome && !tutorialProgress.quantTour);
}

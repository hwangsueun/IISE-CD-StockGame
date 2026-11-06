// The game reports its raw score; reward and grade remain server decisions.
import MinigameEmbed from './MinigameEmbed';

export default function AvoidProfessor(props) {
  return <MinigameEmbed {...props} game="avoid_professor" file="Minigame_Professor_Proposal_v2.html" title="교수님을 피해라" />;
}

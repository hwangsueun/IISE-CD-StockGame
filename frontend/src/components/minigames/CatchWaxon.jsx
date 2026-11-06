// The game reports its raw score; reward and grade remain server decisions.
import MinigameEmbed from './MinigameEmbed';

export default function CatchWaxon(props) {
  return <MinigameEmbed {...props} game="catch_waxon" file="Minigame_Catch_Waxon.html" title="왝슨을 잡아라" />;
}

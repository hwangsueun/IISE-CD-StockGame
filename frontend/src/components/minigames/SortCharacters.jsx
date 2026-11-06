// The game reports its raw score; reward and grade remain server decisions.
import MinigameEmbed from './MinigameEmbed';

export default function SortCharacters(props) {
  return <MinigameEmbed {...props} game="sort_characters" file="Minigame_Sort_Characters.html" title="상자에 캐릭터 분류하기" tall />;
}

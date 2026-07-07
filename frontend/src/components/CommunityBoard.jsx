// 종토방 (읽기 전용 NPC 게시판) — 종목 상세 모달 내 탭
import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function CommunityBoard({ assetId, date }) {
  const [posts, setPosts] = useState([]);
  const [openPost, setOpenPost] = useState(null);
  const [comments, setComments] = useState([]);

  useEffect(() => {
    api.getCommunityPosts(assetId, date).then(setPosts).catch(console.error);
  }, [assetId, date]);

  const togglePost = async (post) => {
    if (openPost?.id === post.id) return setOpenPost(null);
    setOpenPost(post);
    setComments(await api.getPostComments(post.id));
  };

  return (
    <div className="community-board">
      {posts.length === 0 && <p className="news-empty">아직 글이 없다.</p>}
      <ul>
        {posts.map((p) => (
          <li key={p.id} className="community-post">
            <button onClick={() => togglePost(p)}>
              <span className="post-title">{p.title}</span>
              <span className="post-meta">{p.npc_nickname} · {String(p.post_date).slice(0, 10)} · 추천 {p.recommend_count}</span>
            </button>
            {openPost?.id === p.id && (
              <div className="post-body">
                <p>{p.body}</p>
                <ul className="comment-list">
                  {comments.map((c) => (
                    <li key={c.id}><b>{c.npc_nickname}</b> {c.body}</li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

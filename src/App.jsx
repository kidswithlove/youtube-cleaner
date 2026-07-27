import React, { useState, useMemo } from 'react';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';
import axios from 'axios';

const CLIENT_ID = "357551759349-ctirkokl4mrevg2q3ja04nlk00j8p121.apps.googleusercontent.com";

function MainApp() {
  const [accessToken, setAccessToken] = useState(null);
  const [channels, setChannels] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  
  const [sortBy, setSortBy] = useState('default');
  const [searchTerm, setSearchTerm] = useState('');
  const [videoThumbnails, setVideoThumbnails] = useState({});

  // 1. 구글 OAuth2 로그인
  const login = useGoogleLogin({
    onSuccess: (tokenResponse) => {
      setAccessToken(tokenResponse.access_token);
      fetchSubscriptions(tokenResponse.access_token);
    },
    scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
    onError: (error) => alert('로그인 실패: ' + JSON.stringify(error)),
  });

  // 2. 유튜브 구독 목록 전체 가져오기
  const fetchSubscriptions = async (token) => {
    setLoading(true);
    setLoadingMsg('유튜브 구독 목록을 불러오는 중입니다...');
    let allChannels = [];
    let nextPageToken = '';

    try {
      do {
        const response = await axios.get('https://www.googleapis.com/youtube/v3/subscriptions', {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            part: 'snippet',
            mine: true,
            maxResults: 50,
            pageToken: nextPageToken,
          },
        });

        const items = response.data.items.map((item) => ({
          subscriptionId: item.id,
          channelId: item.snippet.resourceId.channelId,
          title: item.snippet.title,
          thumbnail: item.snippet.thumbnails.default?.url || '',
        }));

        allChannels = [...allChannels, ...items];
        nextPageToken = response.data.nextPageToken || '';
      } while (nextPageToken);

      setChannels(allChannels);
    } catch (err) {
      console.error(err);
      alert('구독 목록을 가져오는 데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 3. 최신 영상 썸네일 가져오기
  const fetchLatestVideos = async () => {
    if (!accessToken || channels.length === 0) return;
    
    const targetChannels = channels.slice(0, 20);
    const confirmFetch = window.confirm(
      `API 할당량 보호를 위해 목록 상위 ${targetChannels.length}개 채널의 최신 영상 썸네일을 불러옵니다. 진행하시겠습니까?`
    );
    if (!confirmFetch) return;

    setLoading(true);
    setLoadingMsg('최신 영상 정보를 불러오는 중...');
    const newThumbnails = { ...videoThumbnails };

    for (const channel of targetChannels) {
      if (newThumbnails[channel.channelId]) continue;
      try {
        const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            part: 'snippet',
            channelId: channel.channelId,
            maxResults: 1,
            order: 'date',
            type: 'video',
          },
        });
        if (res.data.items.length > 0) {
          newThumbnails[channel.channelId] = res.data.items[0].snippet.thumbnails.medium?.url || '';
        }
      } catch (err) {
        console.error(`영상 조회 실패 (${channel.title}):`, err);
      }
    }

    setVideoThumbnails(newThumbnails);
    setLoading(false);
  };

  // 4. 정렬 및 검색 처리된 채널 목록
  const processedChannels = useMemo(() => {
    let list = [...channels];

    if (searchTerm.trim() !== '') {
      list = list.filter((c) => c.title.toLowerCase().includes(searchTerm.toLowerCase()));
    }

    if (sortBy === 'name') {
      list.sort((a, b) => a.title.localeCompare(b.title, 'ko'));
    }

    return list;
  }, [channels, sortBy, searchTerm]);

  // 5. 클릭 시 토글 선택
  const handleChannelClick = (e, subscriptionId, index) => {
    const newSelected = new Set(selectedIds);

    if (e.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      
      for (let i = start; i <= end; i++) {
        newSelected.add(processedChannels[i].subscriptionId);
      }
    } else {
      if (newSelected.has(subscriptionId)) {
        newSelected.delete(subscriptionId);
      } else {
        newSelected.add(subscriptionId);
      }
      setLastSelectedIndex(index);
    }

    setSelectedIds(newSelected);
  };

  // 6. 유튜브 채널 페이지 새 탭으로 열기 (선택 이벤트 방지)
  const handleOpenChannel = (e, channelId) => {
    e.stopPropagation(); // 카드 선택(클릭) 이벤트 발생 방지
    window.open(`https://www.youtube.com/channel/${channelId}`, '_blank');
  };

  const handleSelectAll = () => {
    if (selectedIds.size === processedChannels.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(processedChannels.map((c) => c.subscriptionId)));
    }
  };

  // 7. 실제 구독 취소
  const handleUnsubscribeSelected = async () => {
    if (selectedIds.size === 0) return;

    const confirmDelete = window.confirm(`선택한 ${selectedIds.size}개 채널을 정말로 구독 취소하시겠습니까?`);
    if (!confirmDelete) return;

    setLoading(true);
    setLoadingMsg('구독 취소 작업 진행 중...');
    const selectedArray = Array.from(selectedIds);

    for (const subId of selectedArray) {
      try {
        await axios.delete('https://www.googleapis.com/youtube/v3/subscriptions', {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { id: subId },
        });
      } catch (err) {
        console.error(`구독 취소 실패 (${subId}):`, err);
      }
    }

    const updatedChannels = channels.filter((c) => !selectedIds.has(c.subscriptionId));
    setChannels(updatedChannels);
    setSelectedIds(new Set());
    setLastSelectedIndex(null);
    setLoading(false);
    alert('선택한 채널의 구독 취소가 완료되었습니다!');
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#121212', color: '#e0e0e0', padding: '28px', fontFamily: "'Pretendard', sans-serif", userSelect: 'none' }}>
      {!accessToken ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '16px', backgroundColor: '#ff4757', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', marginBottom: '20px', boxShadow: '0 8px 24px rgba(255,71,87,0.3)' }}>
            📺
          </div>
          <h1 style={{ fontSize: '32px', fontWeight: '800', color: '#ffffff', marginBottom: '12px' }}>YouTube Manager</h1>
          <p style={{ color: '#a0a0a0', marginBottom: '32px', fontSize: '15px' }}>구독 채널 대량 다중 선택 및 원클릭 정리 프로그램</p>
          <button
            onClick={() => login()}
            style={{ padding: '14px 28px', backgroundColor: '#ff4757', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '700', cursor: 'pointer', boxShadow: '0 4px 16px rgba(255,71,87,0.4)', transition: 'all 0.2s' }}
          >
            Google 계정으로 시작하기
          </button>
        </div>
      ) : (
        <>
          {/* 상단 헤더 */}
          <div style={{ position: 'sticky', top: 0, backgroundColor: 'rgba(18, 18, 18, 0.92)', backdropFilter: 'blur(12px)', zIndex: 10, paddingBottom: '20px', marginBottom: '24px', borderBottom: '1px solid #2a2a2a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
              <div>
                <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#ffffff', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ color: '#ff4757' }}>●</span> 구독 채널 정리 대시보드
                </h1>
                <p style={{ fontSize: '13px', color: '#888888', marginTop: '6px', margin: 0 }}>
                  팁: 채널 카드의 우측 하단 <span style={{ color: '#ff4757', fontWeight: 'bold' }}>↗</span> 버튼을 누르면 해당 유튜브 채널을 새 탭에서 열어볼 수 있습니다.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={fetchLatestVideos}
                  disabled={loading}
                  style={{ padding: '10px 16px', backgroundColor: '#2a2a2a', color: '#2ed573', border: '1px solid #2ed573', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}
                >
                  🎬 최신 영상 썸네일 로드
                </button>
                <button
                  onClick={handleSelectAll}
                  disabled={loading}
                  style={{ padding: '10px 16px', backgroundColor: '#2a2a2a', color: '#fff', border: '1px solid #3a3a3a', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}
                >
                  {selectedIds.size === processedChannels.length ? '전체 해제' : '전체 선택'}
                </button>
                
                <button
                  onClick={handleUnsubscribeSelected}
                  disabled={selectedIds.size === 0 || loading}
                  style={{
                    padding: '10px 22px',
                    borderRadius: '10px',
                    border: 'none',
                    fontWeight: '700',
                    fontSize: '13px',
                    cursor: selectedIds.size > 0 && !loading ? 'pointer' : 'not-allowed',
                    backgroundColor: selectedIds.size > 0 ? '#ff4757' : '#2a2a2a',
                    color: selectedIds.size > 0 ? '#fff' : '#555',
                    boxShadow: selectedIds.size > 0 ? '0 4px 12px rgba(255,71,87,0.3)' : 'none',
                  }}
                >
                  {loading ? '처리 중...' : `선택한 ${selectedIds.size}개 구독 취소`}
                </button>
              </div>
            </div>

            {/* 필터 및 검색 바 */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="채널 이름 검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  padding: '8px 14px',
                  backgroundColor: '#1e1e1e',
                  border: '1px solid #333',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '13px',
                  outline: 'none',
                  width: '220px'
                }}
              />

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#1e1e1e',
                  border: '1px solid #333',
                  borderRadius: '8px',
                  color: '#ccc',
                  fontSize: '13px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="default">정렬: 최신 구독순</option>
                <option value="name">정렬: 채널 이름순 (가나다)</option>
              </select>

              <div style={{ fontSize: '13px', color: '#888', marginLeft: 'auto' }}>
                선택됨: <strong style={{ color: '#ff4757' }}>{selectedIds.size}</strong>개 / 전체 {processedChannels.length}개
              </div>
            </div>
          </div>

          {loading && <div style={{ color: '#ff4757', marginBottom: '16px', fontWeight: 'bold', fontSize: '14px' }}>⏳ {loadingMsg}</div>}

          {/* 메인 바둑판 (Grid) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
            {processedChannels.map((channel, index) => {
              const isSelected = selectedIds.has(channel.subscriptionId);
              const latestVideoThumb = videoThumbnails[channel.channelId];

              return (
                <div
                  key={channel.subscriptionId}
                  onClick={(e) => handleChannelClick(e, channel.subscriptionId, index)}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '16px',
                    paddingBottom: '28px', // 아래쪽 새 탭 버튼 공간 확보
                    backgroundColor: isSelected ? '#2c1e21' : '#1e1e1e',
                    borderRadius: '16px',
                    border: isSelected ? '2px solid #ff4757' : '1px solid #2a2a2a',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: isSelected ? '0 4px 16px rgba(255,71,87,0.2)' : 'none'
                  }}
                >
                  {/* 상단 우측: 체크 아이콘 */}
                  <div style={{
                    position: 'absolute',
                    top: '10px',
                    right: '10px',
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    border: isSelected ? '1px solid #ff4757' : '1px solid #444',
                    backgroundColor: isSelected ? '#ff4757' : 'rgba(0,0,0,0.3)',
                    color: '#fff',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold'
                  }}>
                    {isSelected && '✓'}
                  </div>

                  {/* 프로필 및 최신 영상 썸네일 영역 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', width: '100%', justifyContent: 'center' }}>
                    <img
                      src={channel.thumbnail}
                      alt={channel.title}
                      style={{ width: '60px', height: '60px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #333', pointerEvents: 'none' }}
                    />

                    {latestVideoThumb && (
                      <div style={{ position: 'relative' }}>
                        <img
                          src={latestVideoThumb}
                          alt="최신 영상"
                          style={{ width: '80px', height: '45px', borderRadius: '6px', objectFit: 'cover', border: '1px solid #444', pointerEvents: 'none' }}
                        />
                        <span style={{ position: 'absolute', bottom: '2px', right: '2px', background: 'rgba(0,0,0,0.8)', color: '#2ed573', fontSize: '9px', padding: '1px 3px', borderRadius: '2px', fontWeight: 'bold' }}>NEW</span>
                      </div>
                    )}
                  </div>

                  {/* 채널 정보 */}
                  <div style={{ textAlign: 'center', width: '100%', pointerEvents: 'none' }}>
                    <div style={{ fontWeight: '700', fontSize: '14px', color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {channel.title}
                    </div>
                  </div>

                  {/* 하단 우측: 유튜브 채널 바로가기 (새 탭) 버튼 */}
                  <button
                    onClick={(e) => handleOpenChannel(e, channel.channelId)}
                    title="유튜브 채널 새 탭으로 열기"
                    style={{
                      position: 'absolute',
                      bottom: '8px',
                      right: '10px',
                      background: 'none',
                      border: 'none',
                      color: '#888',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => e.target.style.color = '#ff4757'}
                    onMouseLeave={(e) => e.target.style.color = '#888'}
                  >
                    ↗
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <GoogleOAuthProvider clientId={CLIENT_ID}>
      <MainApp />
    </GoogleOAuthProvider>
  );
}
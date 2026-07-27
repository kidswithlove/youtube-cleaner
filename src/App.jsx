import React, { useState, useMemo, useEffect } from 'react';
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

  // 화면 폭 변화 감지 (모바일 환경 여부)
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  // 6. 유튜브 채널 페이지 새 탭으로 열기
  const handleOpenChannel = (e, channelId) => {
    e.stopPropagation();
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
    <div style={{ minHeight: '100vh', backgroundColor: '#121212', color: '#e0e0e0', padding: isMobile ? '12px' : '28px', fontFamily: "'Pretendard', sans-serif", userSelect: 'none' }}>
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
          <div style={{ position: 'sticky', top: 0, backgroundColor: 'rgba(18, 18, 18, 0.92)', backdropFilter: 'blur(12px)', zIndex: 10, paddingBottom: '16px', marginBottom: '16px', borderBottom: '1px solid #2a2a2a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
              <div>
                <h1 style={{ fontSize: isMobile ? '18px' : '24px', fontWeight: '800', color: '#ffffff', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#ff4757' }}>●</span> 구독 채널 정리 대시보드
                </h1>
              </div>

              <div style={{ display: 'flex', gap: '8px', width: isMobile ? '100%' : 'auto', justifyContent: 'flex-end' }}>
                <button
                  onClick={fetchLatestVideos}
                  disabled={loading}
                  style={{ padding: '8px 12px', backgroundColor: '#2a2a2a', color: '#2ed573', border: '1px solid #2ed573', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '12px', flex: isMobile ? '1' : 'none' }}
                >
                  🎬 썸네일
                </button>
                <button
                  onClick={handleSelectAll}
                  disabled={loading}
                  style={{ padding: '8px 12px', backgroundColor: '#2a2a2a', color: '#fff', border: '1px solid #3a3a3a', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}
                >
                  {selectedIds.size === processedChannels.length ? '해제' : '전체선택'}
                </button>
                
                <button
                  onClick={handleUnsubscribeSelected}
                  disabled={selectedIds.size === 0 || loading}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    fontWeight: '700',
                    fontSize: '12px',
                    cursor: selectedIds.size > 0 && !loading ? 'pointer' : 'not-allowed',
                    backgroundColor: selectedIds.size > 0 ? '#ff4757' : '#2a2a2a',
                    color: selectedIds.size > 0 ? '#fff' : '#555',
                    boxShadow: selectedIds.size > 0 ? '0 4px 12px rgba(255,71,87,0.3)' : 'none',
                  }}
                >
                  {loading ? '...' : `취소 (${selectedIds.size})`}
                </button>
              </div>
            </div>

            {/* 필터 및 검색 바 */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="채널 검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#1e1e1e',
                  border: '1px solid #333',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '12px',
                  outline: 'none',
                  flex: isMobile ? '1' : 'none',
                  width: isMobile ? 'auto' : '200px'
                }}
              />

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  padding: '8px 10px',
                  backgroundColor: '#1e1e1e',
                  border: '1px solid #333',
                  borderRadius: '8px',
                  color: '#ccc',
                  fontSize: '12px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="default">최신순</option>
                <option value="name">이름순</option>
              </select>

              <div style={{ fontSize: '12px', color: '#888', marginLeft: 'auto' }}>
                <strong style={{ color: '#ff4757' }}>{selectedIds.size}</strong> / {processedChannels.length}개
              </div>
            </div>
          </div>

          {loading && <div style={{ color: '#ff4757', marginBottom: '16px', fontWeight: 'bold', fontSize: '13px' }}>⏳ {loadingMsg}</div>}

          {/* 메인 바둑판 (Grid) - 모바일 대응 크기 조정 */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(130px, 1fr))' : 'repeat(auto-fill, minmax(180px, 1fr))', 
            gap: isMobile ? '8px' : '16px' 
          }}>
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
                    padding: isMobile ? '10px 8px 24px 8px' : '16px 16px 28px 16px',
                    backgroundColor: isSelected ? '#2c1e21' : '#1e1e1e',
                    borderRadius: '12px',
                    border: isSelected ? '2px solid #ff4757' : '1px solid #2a2a2a',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {/* 상단 우측: 체크 아이콘 */}
                  <div style={{
                    position: 'absolute',
                    top: '6px',
                    right: '6px',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    border: isSelected ? '1px solid #ff4757' : '1px solid #444',
                    backgroundColor: isSelected ? '#ff4757' : 'rgba(0,0,0,0.3)',
                    color: '#fff',
                    fontSize: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold'
                  }}>
                    {isSelected && '✓'}
                  </div>

                  {/* 프로필 및 최신 영상 썸네일 영역 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', width: '100%', justifyContent: 'center' }}>
                    <img
                      src={channel.thumbnail}
                      alt={channel.title}
                      style={{ 
                        width: isMobile ? '42px' : '56px', 
                        height: isMobile ? '42px' : '56px', 
                        borderRadius: '50%', 
                        objectFit: 'cover', 
                        border: '1px solid #333', 
                        pointerEvents: 'none' 
                      }}
                    />

                    {latestVideoThumb && (
                      <div style={{ position: 'relative' }}>
                        <img
                          src={latestVideoThumb}
                          alt="최신 영상"
                          style={{ 
                            width: isMobile ? '56px' : '70px', 
                            height: isMobile ? '32px' : '40px', 
                            borderRadius: '4px', 
                            objectFit: 'cover', 
                            border: '1px solid #444', 
                            pointerEvents: 'none' 
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* 채널 정보 */}
                  <div style={{ textAlign: 'center', width: '100%', pointerEvents: 'none' }}>
                    <div style={{ fontWeight: '600', fontSize: isMobile ? '12px' : '14px', color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {channel.title}
                    </div>
                  </div>

                  {/* 하단 우측: 유튜브 채널 바로가기 버튼 */}
                  <button
                    onClick={(e) => handleOpenChannel(e, channel.channelId)}
                    title="유튜브 채널 새 탭으로 열기"
                    style={{
                      position: 'absolute',
                      bottom: '4px',
                      right: '6px',
                      background: 'none',
                      border: 'none',
                      color: '#888',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      padding: '2px 4px',
                    }}
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
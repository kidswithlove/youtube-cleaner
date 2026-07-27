import React, { useState, useMemo, useEffect } from 'react';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';
import axios from 'axios';

const CLIENT_ID = "357551759349-ctirkokl4mrevg2q3ja04nlk00j8p121.apps.googleusercontent.com";

const CATEGORY_MAP = {
  '1': '영화/애니', '2': '자동차', '10': '음악', '15': '반려동물',
  '17': '스포츠', '19': '여행', '20': '게임', '22': '일상/블로그',
  '23': '코미디', '24': '엔터테인먼트', '25': '뉴스/정치', '26': '노하우/스타일',
  '27': '교육', '28': '과학기술', '29': '비영리/사회'
};

function MainApp() {
  const [accessToken, setAccessToken] = useState(null);
  const [channels, setChannels] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [protectedIds, setProtectedIds] = useState(new Set()); // 🔒 구독 보호된 채널 ID 세트
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  
  // 정렬 및 필터 상태
  const [sortBy, setSortBy] = useState('default');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLang, setSelectedLang] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [filterProtectedOnly, setFilterProtectedOnly] = useState(false);

  // 추가 상세 데이터 (최신 영상 날짜, 카테고리, 언어)
  const [channelDetails, setChannelDetails] = useState({});

  // 화면 폭 감지
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

  // 2. 유튜브 구독 목록 가져오기
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

  // 3. 언어 판별
  const detectLanguage = (text) => {
    if (!text) return '기타';
    const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;
    const japaneseRegex = /[\u3040-\u30ff\u31f0-\u31ff]/;
    
    if (koreanRegex.test(text)) return '한국어';
    if (japaneseRegex.test(text)) return '일본어';
    return '영어/기타';
  };

  // 4. 채널 상세 분석
  const analyzeChannels = async () => {
    if (!accessToken || channels.length === 0) return;
    
    const limit = Math.min(channels.length, 30);
    const confirmFetch = window.confirm(
      `API 할당량 보호를 위해 상위 ${limit}개 채널의 최신 영상, 분야, 언어 정보를 분석합니다. 진행하시겠습니까?`
    );
    if (!confirmFetch) return;

    setLoading(true);
    setLoadingMsg('채널별 최신 영상 및 카테고리/언어 분석 중...');
    const newDetails = { ...channelDetails };

    for (let i = 0; i < limit; i++) {
      const channel = channels[i];
      if (newDetails[channel.channelId]) continue;

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
          const video = res.data.items[0].snippet;
          const videoId = res.data.items[0].id.videoId;

          let categoryName = '기타';
          try {
            const videoDetailRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
              headers: { Authorization: `Bearer ${accessToken}` },
              params: {
                part: 'snippet',
                id: videoId
              }
            });
            if (videoDetailRes.data.items.length > 0) {
              const catId = videoDetailRes.data.items[0].snippet.categoryId;
              categoryName = CATEGORY_MAP[catId] || '기타';
            }
          } catch (e) {
            console.error("카테고리 로드 실패", e);
          }

          const lang = detectLanguage(channel.title + " " + video.title);

          newDetails[channel.channelId] = {
            publishedAt: new Date(video.publishedAt),
            thumb: video.thumbnails.medium?.url || '',
            videoTitle: video.title,
            category: categoryName,
            language: lang,
          };
        }
      } catch (err) {
        console.error(`상세 분석 실패 (${channel.title}):`, err);
      }
    }

    setChannelDetails(newDetails);
    setLoading(false);
  };

  // 5. 정렬 및 검색, 필터 처리
  const processedChannels = useMemo(() => {
    let list = [...channels];

    if (searchTerm.trim() !== '') {
      list = list.filter((c) => c.title.toLowerCase().includes(searchTerm.toLowerCase()));
    }

    if (selectedLang !== 'all') {
      list = list.filter((c) => channelDetails[c.channelId]?.language === selectedLang);
    }

    if (selectedCategory !== 'all') {
      list = list.filter((c) => channelDetails[c.channelId]?.category === selectedCategory);
    }

    if (filterProtectedOnly) {
      list = list.filter((c) => protectedIds.has(c.channelId));
    }

    if (sortBy === 'name') {
      list.sort((a, b) => a.title.localeCompare(b.title, 'ko'));
    } else if (sortBy === 'latest_video') {
      list.sort((a, b) => {
        const dateA = channelDetails[a.channelId]?.publishedAt || new Date(0);
        const dateB = channelDetails[b.channelId]?.publishedAt || new Date(0);
        return dateB - dateA;
      });
    } else if (sortBy === 'oldest_video') {
      list.sort((a, b) => {
        const dateA = channelDetails[a.channelId]?.publishedAt || new Date(8640000000000000);
        const dateB = channelDetails[b.channelId]?.publishedAt || new Date(8640000000000000);
        return dateA - dateB;
      });
    }

    return list;
  }, [channels, sortBy, searchTerm, selectedLang, selectedCategory, filterProtectedOnly, protectedIds, channelDetails]);

  // 클릭 선택 처리
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

  // 🔒 구독 보호(절대 취소 금지) 토글
  const toggleProtectChannel = (e, channelId) => {
    e.stopPropagation();
    const newProtected = new Set(protectedIds);
    if (newProtected.has(channelId)) {
      newProtected.delete(channelId);
    } else {
      newProtected.add(channelId);
      // 만약 선택 상태였다면 선택 해제
      const targetSub = channels.find(c => c.channelId === channelId);
      if (targetSub) {
        const newSelected = new Set(selectedIds);
        newSelected.delete(targetSub.subscriptionId);
        setSelectedIds(newSelected);
      }
    }
    setProtectedIds(newProtected);
  };

  // 🛡️ 보호된 채널을 '제외'하고 모든 채널 선택하기
  const handleSelectAllExceptProtected = () => {
    const selectable = processedChannels.filter(c => !protectedIds.has(c.channelId));
    
    // 이미 보호 제외 전체 선택이 다 되어 있다면 해제
    const allSelectableChosen = selectable.every(c => selectedIds.has(c.subscriptionId));
    
    if (allSelectableChosen && selectable.length > 0) {
      setSelectedIds(new Set());
    } else {
      const newSelected = new Set(selectable.map(c => c.subscriptionId));
      setSelectedIds(newSelected);
    }
  };

  const handleOpenChannel = (e, channelId) => {
    e.stopPropagation();
    window.open(`https://www.youtube.com/channel/${channelId}`, '_blank');
  };

  // 구독 취소 (보호된 채널 자동 방어)
  const handleUnsubscribeSelected = async () => {
    if (selectedIds.size === 0) return;

    const confirmDelete = window.confirm(`선택한 ${selectedIds.size}개 채널을 정말로 구독 취소하시겠습니까?\n(보호 지정된 채널은 포함되지 않습니다)`);
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
    <div style={{ minHeight: '100vh', backgroundColor: '#0f0f12', color: '#e0e0e0', padding: isMobile ? '12px' : '28px', fontFamily: "'Pretendard', sans-serif", userSelect: 'none' }}>
      {!accessToken ? (
        /* ✨ 화려하고 멋진 스플래시/로그인 화면 */
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          minHeight: '85vh',
          background: 'radial-gradient(circle at center, #2a111a 0%, #0f0f12 70%)',
          borderRadius: '24px',
          padding: '20px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255, 71, 87, 0.15)'
        }}>
          {/* 빛나는 뱃지 */}
          <div style={{
            padding: '6px 16px',
            borderRadius: '20px',
            background: 'rgba(255, 71, 87, 0.15)',
            border: '1px solid rgba(255, 71, 87, 0.4)',
            color: '#ff4757',
            fontSize: '13px',
            fontWeight: '700',
            marginBottom: '24px',
            letterSpacing: '1px'
          }}>
            ⚡ SMART YOUTUBE SUBSCRIPTION CLEANER
          </div>

          {/* 대형 글로우 로고 */}
          <div style={{ 
            width: '88px', 
            height: '88px', 
            borderRadius: '24px', 
            background: 'linear-gradient(135deg, #ff4757 0%, #ff6b81 100%)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            fontSize: '44px', 
            marginBottom: '24px', 
            boxShadow: '0 12px 32px rgba(255, 71, 87, 0.45)',
            transform: 'scale(1)',
            transition: 'transform 0.3s'
          }}>
            📺
          </div>

          {/* 메인 타이틀 */}
          <h1 style={{ 
            fontSize: isMobile ? '28px' : '42px', 
            fontWeight: '900', 
            color: '#ffffff', 
            marginBottom: '14px',
            textAlign: 'center',
            background: 'linear-gradient(to right, #ffffff, #ffa4b0)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            YouTube Subscription Manager
          </h1>

          <p style={{ color: '#a0a0b0', marginBottom: '36px', fontSize: isMobile ? '14px' : '17px', textAlign: 'center', maxWidth: '500px', lineHeight: '1.6' }}>
            수백 개의 유튜브 구독 채널, <b>카테고리/언어별 분석</b>부터 <br/>
            <b>🔒 절대 취소 방지 보호 기능</b>까지 한눈에 스마트하게 정리하세요.
          </p>

          {/* 로그인 버튼 */}
          <button
            onClick={() => login()}
            style={{ 
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '16px 36px', 
              background: 'linear-gradient(135deg, #ff4757 0%, #ff2e43 100%)', 
              color: '#fff', 
              border: 'none', 
              borderRadius: '16px', 
              fontSize: '17px', 
              fontWeight: '800', 
              cursor: 'pointer', 
              boxShadow: '0 8px 25px rgba(255, 71, 87, 0.4)', 
              transition: 'all 0.25s ease' 
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 1.76-1.82 3.08-3.78 3.08-2.33 0-4.23-1.9-4.23-4.23s1.9-4.23 4.23-4.23c1.07 0 2.03.39 2.77 1.05l2.05-2.05C18.3 6.13 16.2 5.3 13.9 5.3 9.4 5.3 5.75 8.95 5.75 13.45s3.65 8.15 8.15 8.15c4.7 0 7.8-3.3 7.8-7.9 0-.6-.05-1.15-.35-1.6z"/>
            </svg>
            Google 계정으로 바로 시작하기
          </button>
        </div>
      ) : (
        <>
          {/* 상단 헤더 & 컨트롤 레이아웃 */}
          <div style={{ position: 'sticky', top: 0, backgroundColor: 'rgba(15, 15, 18, 0.95)', backdropFilter: 'blur(16px)', zIndex: 10, paddingBottom: '16px', marginBottom: '16px', borderBottom: '1px solid #222' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
              <div>
                <h1 style={{ fontSize: isMobile ? '18px' : '22px', fontWeight: '800', color: '#ffffff', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#ff4757' }}>●</span> 구독 채널 정리 대시보드
                </h1>
              </div>

              {/* 버튼 세트 */}
              <div style={{ display: 'flex', gap: '8px', width: isMobile ? '100%' : 'auto', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  onClick={analyzeChannels}
                  disabled={loading}
                  style={{ padding: '8px 12px', backgroundColor: '#1e2820', color: '#2ed573', border: '1px solid #2ed573', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}
                >
                  🔍 업로드/언어/분야 분석
                </button>

                <button
                  onClick={handleSelectAllExceptProtected}
                  disabled={loading}
                  title="보호 지정된 채널을 제외하고 선택합니다"
                  style={{ padding: '8px 12px', backgroundColor: '#2a1a20', color: '#ff788e', border: '1px solid #ff4757', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}
                >
                  🛡️ 보호 제외 전체선택
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
                    backgroundColor: selectedIds.size > 0 ? '#ff4757' : '#222',
                    color: selectedIds.size > 0 ? '#fff' : '#555',
                  }}
                >
                  {loading ? '...' : `선택 취소 (${selectedIds.size})`}
                </button>
              </div>
            </div>

            {/* 필터 및 정렬 옵션 바 */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="채널 검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#18181c',
                  border: '1px solid #333',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '12px',
                  outline: 'none',
                  width: isMobile ? '100%' : '160px'
                }}
              />

              {/* 정렬 드롭다운 */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{ padding: '8px 10px', backgroundColor: '#18181c', border: '1px solid #333', borderRadius: '8px', color: '#ccc', fontSize: '12px', outline: 'none' }}
              >
                <option value="default">정렬: 최신 구독순</option>
                <option value="name">정렬: 채널 이름순</option>
                <option value="latest_video">정렬: 최신 업로드순 (최근부터)</option>
                <option value="oldest_video">정렬: 최신 업로드순 (오래된순)</option>
              </select>

              {/* 언어 필터 */}
              <select
                value={selectedLang}
                onChange={(e) => setSelectedLang(e.target.value)}
                style={{ padding: '8px 10px', backgroundColor: '#18181c', border: '1px solid #333', borderRadius: '8px', color: '#ccc', fontSize: '12px', outline: 'none' }}
              >
                <option value="all">언어: 전체</option>
                <option value="한국어">한국어</option>
                <option value="일본어">일본어</option>
                <option value="영어/기타">영어/기타</option>
              </select>

              {/* 카테고리 필터 */}
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                style={{ padding: '8px 10px', backgroundColor: '#18181c', border: '1px solid #333', borderRadius: '8px', color: '#ccc', fontSize: '12px', outline: 'none' }}
              >
                <option value="all">분야: 전체</option>
                <option value="게임">게임</option>
                <option value="음악">음악</option>
                <option value="엔터테인먼트">엔터테인먼트</option>
                <option value="일상/블로그">일상/블로그</option>
                <option value="노하우/스타일">노하우/스타일</option>
                <option value="교육">교육</option>
                <option value="기타">기타</option>
              </select>

              {/* 🔒 보호된 채널만 보기 체크박스 */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer', color: filterProtectedOnly ? '#ff4757' : '#888' }}>
                <input 
                  type="checkbox" 
                  checked={filterProtectedOnly} 
                  onChange={(e) => setFilterProtectedOnly(e.target.checked)}
                />
                🔒 보호 채널만 보기 ({protectedIds.size})
              </label>

              <div style={{ fontSize: '12px', color: '#888', marginLeft: 'auto' }}>
                선택: <strong style={{ color: '#ff4757' }}>{selectedIds.size}</strong> / {processedChannels.length}개
              </div>
            </div>
          </div>

          {loading && <div style={{ color: '#ff4757', marginBottom: '16px', fontWeight: 'bold', fontSize: '13px' }}>⏳ {loadingMsg}</div>}

          {/* 채널 카드리스트 바둑판 */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(130px, 1fr))' : 'repeat(auto-fill, minmax(170px, 1fr))', 
            gap: isMobile ? '8px' : '14px' 
          }}>
            {processedChannels.map((channel, index) => {
              const isSelected = selectedIds.has(channel.subscriptionId);
              const isProtected = protectedIds.has(channel.channelId);
              const detail = channelDetails[channel.channelId];

              return (
                <div
                  key={channel.subscriptionId}
                  onClick={(e) => {
                    if (!isProtected) handleChannelClick(e, channel.subscriptionId, index);
                  }}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: isMobile ? '10px 8px 24px 8px' : '16px 14px 28px 14px',
                    backgroundColor: isProtected ? '#1c1518' : isSelected ? '#2c1e21' : '#18181c',
                    borderRadius: '12px',
                    border: isProtected 
                      ? '2px solid #ff4757' 
                      : isSelected 
                      ? '2px solid #ff6b81' 
                      : '1px solid #28282e',
                    cursor: isProtected ? 'default' : 'pointer',
                    transition: 'all 0.15s ease',
                    opacity: isProtected ? 0.95 : 1
                  }}
                >
                  {/* 우측 상단: 선택 체크 아이콘 */}
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

                  {/* 좌측 하단: 🔒 절대 구독 취소 방지 보호 버튼 */}
                  <button
                    onClick={(e) => toggleProtectChannel(e, channel.channelId)}
                    title={isProtected ? "구독 보호 해제" : "이 채널은 절대 구독 취소 안 함 (보호)"}
                    style={{
                      position: 'absolute',
                      bottom: '4px',
                      left: '6px',
                      background: isProtected ? 'rgba(255, 71, 87, 0.2)' : 'none',
                      border: isProtected ? '1px solid #ff4757' : 'none',
                      borderRadius: '4px',
                      color: isProtected ? '#ff4757' : '#666',
                      fontSize: '12px',
                      cursor: 'pointer',
                      padding: '2px 4px',
                    }}
                  >
                    {isProtected ? '🔒' : '🔓'}
                  </button>

                  {/* 프로필 이미지 */}
                  <img
                    src={channel.thumbnail}
                    alt={channel.title}
                    style={{ 
                      width: isMobile ? '46px' : '56px', 
                      height: isMobile ? '46px' : '56px', 
                      borderRadius: '50%', 
                      objectFit: 'cover', 
                      border: isProtected ? '2px solid #ff4757' : '1px solid #333', 
                      pointerEvents: 'none',
                      marginBottom: '8px'
                    }}
                  />

                  {/* 채널 이름 */}
                  <div style={{ textAlign: 'center', width: '100%', pointerEvents: 'none' }}>
                    <div style={{ fontWeight: '600', fontSize: isMobile ? '12px' : '13px', color: isProtected ? '#ffa4b0' : '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {channel.title}
                    </div>
                  </div>

                  {/* 상세 태그 (분석 완료 시) */}
                  {detail && (
                    <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', fontSize: '10px', color: '#aaa' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <span style={{ background: '#25252b', padding: '1px 4px', borderRadius: '4px', color: '#2ed573' }}>{detail.language}</span>
                        <span style={{ background: '#25252b', padding: '1px 4px', borderRadius: '4px', color: '#eccc68' }}>{detail.category}</span>
                      </div>
                      {detail.publishedAt && (
                        <span style={{ fontSize: '9px', color: '#777', marginTop: '2px' }}>
                          {detail.publishedAt.toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  )}

                  {/* 우측 하단: 새 탭 바로가기 버튼 */}
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
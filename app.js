// ------------------------------------------------------------------
// 1. Supabase 설정 & 전역 상태
// ------------------------------------------------------------------
const APP_ENV = typeof window !== 'undefined' && window.__APP_ENV ? window.__APP_ENV : {};
function readEnvValue(key, fallback) {
    try {
        const v = localStorage.getItem(key);
        if (v) return v;
    } catch {}
    if (APP_ENV && APP_ENV[key]) return APP_ENV[key];
    return fallback;
}
const SUPABASE_URL = readEnvValue('SUPABASE_URL', 'https://kuvvjslxvwkmjrqdmask.supabase.co');
const SUPABASE_PUBLISHABLE_KEY = readEnvValue('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_dTVvg1YH_7MXhv6nnoe57w_VYZ9Wd6K');
const SUPABASE_ANON_KEY = readEnvValue('SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1dnZqc2x4dndrbWpycWRtYXNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNjE1NTksImV4cCI6MjA4NzkzNzU1OX0.vfL1N10oZze8Ea4cqOnxdmZbaSHIPeMa_V2Y2gXq94s');
const STORAGE_BUCKET = 'images';

const client = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY || SUPABASE_ANON_KEY);

const state = {
    user: null,
    profile: null,
    currentPostId: null,
    postToEdit: null,
    isEditing: false,
    currentStockName: '삼성전자', 
    stockTags: [], 
    stocksMaster: [],
    codeToName: {},
    stockSortMode: 'latest',
    hotRoomsCache: { ts: 0, html: '' },
    stockCategoryFilter: 'all',
    recentStocks: [],
    realtimeChannels: {},
    guestName: `무협객_${Math.floor(Math.random() * 1000)}`,
    replyToCommentId: null, // 대댓글 대상 ID
    previewEnabled: (() => { try { return JSON.parse(localStorage.getItem('preview_enabled') || 'true'); } catch { return true; } })(),
    pagination: {
        limit: 10,
        page: 0,
        hasMore: true,
        isLoading: false
    },
    searchQuery: '',
    relationships: {
        follows: new Set(),
        blocks: new Set(),
        mutes: new Set()
    },
    includeSecretInReco: (() => { try { return JSON.parse(localStorage.getItem('reco_include_secret') || 'false'); } catch { return false; } })(),
    includeSecretInPlaza: (() => { try { return JSON.parse(localStorage.getItem('include_secret_plaza') || 'true'); } catch { return true; } })(),
    plazaFilterType: (() => { try { return localStorage.getItem('plaza_filter') || 'all'; } catch { return 'all'; } })(),
    lastRenderedType: null,
    lastRenderedPosts: [],
    scrollPositions: {},
    currentTargetUserId: null,
    submitLocks: {},
    activityFilter: { keyword: '', days: 30 },
    impressed: new Set(),
    notInterestedPostIds: new Set(),
    recommendedMode: 'mix',
    dataCollectionEnabled: (() => { try { return JSON.parse(localStorage.getItem('reco_logging_enabled') || 'true'); } catch { return true; } })(),
    recommendedCache: {},
    recoBalanceEnabled: (() => { try { return JSON.parse(localStorage.getItem('reco_balance_enabled') || 'true'); } catch { return true; } })()
    ,newsCache: {}
    ,newsRequestId: {}
    ,searchOrderByType: { public: 'rank', stock: 'rank', secret: 'rank' }
    ,infiniteObservers: {}
    ,paginationByType: {
        public: { limit: 10, page: 0, hasMore: true, isLoading: false },
        stock: { limit: 10, page: 0, hasMore: true, isLoading: false },
        secret: { limit: 10, page: 0, hasMore: true, isLoading: false }
    }
};

function getPagination(type) {
    const key = type || 'public';
    if (!state.paginationByType) state.paginationByType = {};
    if (!state.paginationByType[key]) state.paginationByType[key] = { limit: 10, page: 0, hasMore: true, isLoading: false };
    return state.paginationByType[key];
}
function logClientError(payload) {
    try {
        const key = 'client_error_log';
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        arr.unshift({ t: new Date().toISOString(), ...payload });
        localStorage.setItem(key, JSON.stringify(arr.slice(0, 30)));
    } catch {}
}
function logRateLimit(action, reason) {
    try {
        client.rpc('log_rate_limit', {
            p_action: action,
            p_reason: reason,
            p_user_id: state.user ? state.user.id : null,
            p_guest_device_id: state.user ? null : getGuestDeviceId()
        });
    } catch {}
}
try {
    window.addEventListener('error', (e) => {
        logClientError({ type: 'error', message: e?.message || 'unknown', source: e?.filename, line: e?.lineno, col: e?.colno });
    });
    window.addEventListener('unhandledrejection', (e) => {
        const msg = e?.reason?.message || String(e?.reason || 'unknown');
        logClientError({ type: 'unhandledrejection', message: msg });
    });
} catch {}

async function computeRecentCommentMeta(postIds, hours = 72) {
    try {
        const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
        const { data } = await client.from('comments')
            .select('post_id,created_at')
            .in('post_id', postIds)
            .gte('created_at', since)
            .limit(2000);
        const map = {};
        (data || []).forEach(r => {
            const k = r.post_id;
            const ts = r.created_at;
            const m = map[k] || { count: 0, lastTs: null };
            m.count += 1;
            if (!m.lastTs || (new Date(ts).getTime() > new Date(m.lastTs).getTime())) m.lastTs = ts;
            map[k] = m;
        });
        return map;
    } catch {
        return {};
    }
}

try {
    const savedProxy = localStorage.getItem('link_preview_proxy');
    if (savedProxy) window.LINK_PREVIEW_PROXY = savedProxy;
} catch {}
try {
    const rs = JSON.parse(localStorage.getItem('recent_stocks') || '[]');
    if (Array.isArray(rs)) state.recentStocks = rs.slice(0, 8);
} catch {}
try {
    ['public','stock','secret'].forEach(t => {
        const v = localStorage.getItem(`search_order_${t}`);
        if (v) state.searchOrderByType[t] = v;
    });
} catch {}
try {
    const sm = JSON.parse(localStorage.getItem('stocks_master') || '[]');
    if (Array.isArray(sm) && sm.length) {
        state.stocksMaster = sm;
        const map = {};
        sm.forEach(s => { if (s.code && s.name) map[String(s.code).toUpperCase()] = s.name; });
        state.codeToName = map;
    }
} catch {}
const LEVEL_NAMES = ['입문자', '초학자', '시세견습', '기문초해', '자본내공가', '강호시세객', '전략비급사', '시장현경', '초절정투객', '절세투자고수', '금룡장문'];

const MU_GONG_TYPES = [
    { id: 'sword', name: '질풍검법 (단기)', tag: '단기', color: 'text-red-500' },
    { id: 'dao', name: '태극도법 (장기)', tag: '장기', color: 'text-blue-500' },
    { id: 'auto', name: '오토진법 (자동)', tag: '자동', color: 'text-yellow-500' },
];
const BANK_INFO = {
    bank_name: '카카오뱅크',
    account_number: '3333022292950',
    owner_name: '김민혁',
    message: '입금 후 아래 양식으로 확인 요청하시오.'
};

// SEO: Update Meta Tags
function updateMetaTagsForView(viewId, data = null) {
    let title = '강호 광장 - 투자 커뮤니티';
    let description = '한국 무림 세계관으로 즐기는 주식, 코인 투자 커뮤니티. 천금문에서 비급을 공유하시오.';
    let url = window.location.href;

    if (viewId === 'stock-board') {
        title = '종목 비급 - 실시간 종목 토론';
        description = '삼성전자, 에코프로 등 인기 종목에 대한 고수들의 분석과 토론.';
    } else if (viewId === 'secret-inn') {
        title = '암천 객잔 - 자유 투자 수다';
        description = '투자에 지친 영혼들이 쉬어가는 곳. 자유로운 주식 이야기.';
    } else if (viewId === 'post-detail' && data) {
        title = `${data.title} - 강호 광장`;
        description = data.content ? data.content.substring(0, 150).replace(/\n/g, ' ') : description;
    }

    document.title = title;
    
    // Update Open Graph tags
    const setMeta = (property, content) => {
        let element = document.querySelector(`meta[property="${property}"]`);
        if (!element) {
            element = document.createElement('meta');
            element.setAttribute('property', property);
            document.head.appendChild(element);
        }
        element.setAttribute('content', content);
    };

    const setDescription = (content) => {
        let element = document.querySelector(`meta[name="description"]`);
        if (!element) {
            element = document.createElement('meta');
            element.setAttribute('name', 'description');
            document.head.appendChild(element);
        }
        element.setAttribute('content', content);
    };

    setMeta('og:title', title);
    setMeta('og:description', description);
    setMeta('og:url', url);
    setDescription(description);

    // Update JSON-LD
    updateJsonLd(viewId, data);
}

function updateJsonLd(viewId, data) {
    let script = document.getElementById('json-ld');
    if (!script) {
        script = document.createElement('script');
        script.id = 'json-ld';
        script.type = 'application/ld+json';
        document.head.appendChild(script);
    }

    const baseData = {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": "강호 광장",
        "url": window.location.origin,
        "potentialAction": {
            "@type": "SearchAction",
            "target": `${window.location.origin}/search?q={search_term_string}`,
            "query-input": "required name=search_term_string"
        }
    };

    if (viewId === 'post-detail' && data) {
        const articleData = {
            "@context": "https://schema.org",
            "@type": "DiscussionForumPosting",
            "headline": data.title,
            "text": data.content,
            "author": {
                "@type": "Person",
                "name": data.profiles?.nickname || '익명'
            },
            "datePublished": data.created_at,
            "interactionStatistic": {
                "@type": "InteractionCounter",
                "interactionType": "https://schema.org/LikeAction",
                "userInteractionCount": data.like_count || 0
            }
        };
        script.textContent = JSON.stringify(articleData);
    } else {
        script.textContent = JSON.stringify(baseData);
    }
}

// ------------------------------------------------------------------
// 2. 유틸리티 함수
// ------------------------------------------------------------------

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    
    let bgClass = 'bg-gray-800';
    if (type === 'error') bgClass = 'bg-red-900/90 border border-red-700';
    if (type === 'success') bgClass = 'bg-green-900/90 border border-green-700';
    if (type === 'info') bgClass = 'bg-gray-800/90 border border-gray-600';

    toast.className = `${bgClass} text-white px-4 py-2 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 toast-enter`;
    toast.innerHTML = `<span class="flex-1">${message}</span><button class="text-xs bg-gray-700 text-white px-2 py-1 rounded hover:bg-gray-600">닫기</button>`;
    
    container.appendChild(toast);
    const closeBtn = toast.querySelector('button');
    closeBtn.onclick = () => {
        toast.classList.add('toast-exit-active');
        setTimeout(() => { if (toast && toast.parentNode) toast.remove(); }, 300);
    };
    
    // Trigger reflow
    toast.offsetHeight;
    toast.classList.add('toast-enter-active');
    toast.classList.remove('toast-enter');

    setTimeout(() => {
        toast.classList.add('toast-exit-active');
        const removeFn = () => { if (toast && toast.parentNode) toast.remove(); };
        toast.addEventListener('transitionend', removeFn, { once: true });
        setTimeout(removeFn, 400);
    }, 3000);
}

function requireAuth(actionName = '이 기능') {
    if (state.user) return true;
    showToast(`${actionName}은(는) 입문 후 이용 가능하오.`, 'error');
    openModal('authModal');
    return false;
}

function calculateLevel(postCount, commentCount) {
    const score = (postCount || 0) + (commentCount || 0);
    const thresholds = [0, 3, 7, 12, 18, 26, 36, 50, 70, 95, 130];
    let idx = 0;
    for (let i = 0; i < thresholds.length; i++) {
        if (score >= thresholds[i]) idx = i;
        else break;
    }
    idx = Math.min(idx, LEVEL_NAMES.length - 1);
    return { name: LEVEL_NAMES[idx], color: idx > 5 ? 'text-yellow-400' : 'text-cyan-400' };
}

function sanitizeHTML(input) {
    const tmp = document.createElement('div');
    tmp.innerHTML = input || '';
    tmp.querySelectorAll('script, style, iframe, object, embed, link').forEach(n => n.remove());
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_ELEMENT, null);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(el => {
        Array.from(el.attributes).forEach(attr => {
            const n = attr.name.toLowerCase();
            const v = attr.value || '';
            if (n.startsWith('on')) el.removeAttribute(attr.name);
            if ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(v)) el.removeAttribute(attr.name);
            if ((n === 'href' || n === 'src') && /^\s*data:/i.test(v) && !/^\s*data:image\//i.test(v)) el.removeAttribute(attr.name);
        });
    });
    return tmp.innerHTML;
}
function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}
function getExcerpt(html, max = 80) {
    const t = stripHtml(html);
    return t.length > max ? t.slice(0, max) + '…' : t;
}
function linkifyHtml(html, enablePreview = state.previewEnabled) {
    const temp = document.createElement('div');
    temp.innerHTML = sanitizeHTML(html || '');
    const regex = /(https?:\/\/[^\s<]+|www\.[^\s<]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b(?:0(?:2|1\d|[3-6]\d))[-.\s]?\d{3,4}[-.\s]?\d{4}\b|\b(?!https?:\/\/|www\.)[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<]*)?)/gi;
    const walker = document.createTreeWalker(temp, NodeFilter.SHOW_TEXT, null);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach(node => {
        if (node.parentNode && node.parentNode.tagName === 'A') return;
        const t = node.nodeValue;
        if (!regex.test(t)) return;
        const frag = document.createDocumentFragment();
        let last = 0;
        t.replace(regex, (m, _g, idx) => {
            const before = t.slice(last, idx);
            if (before) frag.appendChild(document.createTextNode(before));
            const a = document.createElement('a');
            let href = m;
            let isWeb = false;
            if (m.includes('@')) {
                href = `mailto:${m}`;
            } else if (/^(?:0(?:2|1\d|[3-6]\d))[-.\s]?\d{3,4}[-.\s]?\d{4}$/.test(m)) {
                const tel = m.replace(/[^\d]/g, '');
                href = `tel:${tel}`;
            } else if (m.startsWith('www.')) {
                href = `https://${m}`;
                isWeb = true;
            } else if (/^https?:\/\//i.test(m)) {
                href = m;
                isWeb = true;
            } else {
                href = `https://${m}`;
                isWeb = true;
            }
            a.href = href;
            a.textContent = m;
            if (isWeb) {
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
            }
            a.className = 'text-yellow-400 underline break-all';
            frag.appendChild(a);
            last = idx + m.length;
            return m;
        });
        const after = t.slice(last);
        if (after) frag.appendChild(document.createTextNode(after));
        node.parentNode.replaceChild(frag, node);
    });
    const anchors = Array.from(temp.querySelectorAll('a'));
    const existingVidSet = new Set([
        ...Array.from(temp.querySelectorAll('iframe[src*=\"youtube.com/embed/\"]')).map(ifr => {
            const m = (ifr.getAttribute('src') || '').match(/\/embed\/([A-Za-z0-9_-]{11})/);
            return m ? m[1] : null;
        }).filter(Boolean),
        ...Array.from(temp.querySelectorAll('.yt-embed[data-video-id]')).map(el => el.getAttribute('data-video-id')).filter(Boolean)
    ]);
    if (enablePreview) anchors.forEach(a => {
        if (a.getAttribute('data-preview-added') === '1') return;
        const href = a.getAttribute('href') || '';
        if (/^(mailto:|tel:)/i.test(href)) { a.setAttribute('data-preview-added', '1'); return; }
        try {
            const url = new URL(href.startsWith('http') ? href : `https://${href.replace(/^mailto:|^tel:/, '')}`);
            const host = url.hostname.toLowerCase();
            const isYouTube = host.includes('youtube.com') || host.includes('youtu.be');
            const isImage = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(url.pathname);
            const isSocial = host.includes('twitter.com') || host.includes('x.com') || host.includes('instagram.com') || host.includes('instagr.am');
            if (isYouTube) {
                let vid = '';
                if (host.includes('youtu.be')) {
                    vid = url.pathname.split('/').filter(Boolean)[0] || '';
                } else {
                    vid = url.searchParams.get('v') || '';
                    if (!vid && url.pathname.includes('/embed/')) {
                        vid = url.pathname.split('/').pop() || '';
                    }
                }
                if (vid && vid.length === 11) {
                    if (existingVidSet.has(vid)) {
                        a.setAttribute('data-preview-added', '1');
                        return;
                    }
                    const wrapper = document.createElement('div');
                    wrapper.className = 'yt-embed my-2 rounded-lg overflow-hidden shadow-lg';
                    wrapper.style.aspectRatio = '16 / 9';
                    wrapper.setAttribute('data-video-id', vid);
                    wrapper.setAttribute('onclick', '__yt_embed(this)');
                    const thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
                    wrapper.innerHTML = `<div class="relative w-full h-full bg-black"><img src="${thumb}" alt="" class="w-full h-full object-cover opacity-80"><div class="absolute inset-0 flex items-center justify-center"><div class="bg-red-600 rounded-full w-16 h-16 flex items-center justify-center shadow-lg"><span class="text-white text-2xl">▶</span></div></div></div>`;
                    a.insertAdjacentElement('afterend', wrapper);
                    a.setAttribute('data-preview-added', '1');
                    existingVidSet.add(vid);
                }
            } else if (isImage) {
                const img = document.createElement('img');
                img.src = href;
                img.loading = 'lazy';
                img.className = 'max-w-full h-auto rounded-lg shadow-md my-2';
                a.insertAdjacentElement('afterend', img);
                a.setAttribute('data-preview-added', '1');
            } else if (isSocial) {
                const card = document.createElement('div');
                card.className = 'my-2 rounded-lg border border-gray-700 bg-gray-900/40 p-3';
                card.innerHTML = `<div class="text-xs text-gray-400">${host}</div><div class="text-sm text-white truncate">${a.textContent}</div>`;
                a.insertAdjacentElement('afterend', card);
                a.setAttribute('data-preview-added', '1');
            } else {
                const proxy = window.LINK_PREVIEW_PROXY || null;
                if (proxy) {
                    const card = document.createElement('div');
                    card.className = 'my-2 rounded-lg border border-gray-700 bg-gray-900/40 p-3';
                    card.innerHTML = `<div class="text-xs text-gray-400">${host}</div><div class="text-sm text-white truncate">${a.textContent}</div>`;
                    a.insertAdjacentElement('afterend', card);
                    a.setAttribute('data-preview-added', '1');
                    try {
                        fetch(`${proxy}?url=${encodeURIComponent(url.href)}`, { mode: 'cors' })
                            .then(res => res.ok ? res.json() : null)
                            .then(meta => {
                                if (!meta) return;
                                const title = meta.title || a.textContent;
                                const desc = meta.description || '';
                                const image = meta.image || '';
                                const imgHtml = image ? `<img src="${image}" alt="" class="w-full h-32 object-cover rounded-lg mb-2">` : '';
                                card.innerHTML = `${imgHtml}<div class="text-sm text-white font-bold">${title}</div>${desc ? `<div class="text-xs text-gray-400 mt-1 line-clamp-2">${desc}</div>` : ''}<div class="text-[11px] text-gray-500 mt-1">${host}</div>`;
                            }).catch(() => {});
                    } catch {}
                }
            }
        } catch {}
    });
    return temp.innerHTML;
}
const BAD_WORDS = ['욕설1','욕설2','비속어1','비속어2'];
function containsBadWords(text) {
    const t = (text || '').toLowerCase();
    return BAD_WORDS.some(w => t.includes(w.toLowerCase()));
}
function runLocked(key, fn) {
    if (state.submitLocks[key]) return;
    state.submitLocks[key] = true;
    const done = () => { state.submitLocks[key] = false; };
    try {
        const r = fn();
        if (r && typeof r.then === 'function') {
            r.then(done).catch(done);
        } else {
            done();
        }
    } catch {
        done();
    }
}
window.__yt_embed = function(el) {
    if (!el || el.dataset.embedded === '1') return;
    const vid = el.getAttribute('data-video-id') || '';
    if (!vid) return;
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${vid}?autoplay=1`;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.className = 'rounded-lg';
    iframe.frameBorder = '0';
    iframe.allowFullscreen = true;
    el.innerHTML = '';
    el.appendChild(iframe);
    el.dataset.embedded = '1';
};
window.updatePreviewSetting = function() {
    const chk = document.getElementById('preview-enabled');
    const val = !!chk?.checked;
    state.previewEnabled = val;
    try { localStorage.setItem('preview_enabled', JSON.stringify(val)); } catch {}
    showToast(val ? '자동 프리뷰를 켰소.' : '자동 프리뷰를 껐소.', 'success');
};
window.updateRecoLoggingSetting = function() {
    const chk = document.getElementById('reco-logging-enabled');
    const val = !!chk?.checked;
    state.dataCollectionEnabled = val;
    try { localStorage.setItem('reco_logging_enabled', JSON.stringify(val)); } catch {}
    showToast(val ? '추천 데이터 수집을 켰소.' : '추천 데이터 수집을 껐소.', 'success');
};
function getNewsProxyUrl() {
    try {
        const saved = localStorage.getItem('news_proxy_url');
        const isFile = window.location.protocol === 'file:';
        if (saved && saved.trim()) {
            const s = saved.trim();
            try {
                const u = new URL(s);
                if (!/^https?:$/i.test(u.protocol)) throw new Error('bad protocol');
                if (u.hostname === 'baner-ai.vercel.app') throw new Error('blocked host');
            } catch {
                localStorage.removeItem('news_proxy_url');
            }
            // file:// 환경에서 상대경로(/api/news)는 file:///C:/api/news로 깨지므로 무시
            if (isFile && s.startsWith('/')) {
                // fall through to defaults below
            } else if (!window.location.hostname.includes('vercel.app') && s.startsWith('/')) {
                // 비-Vercel 호스트(GitHub Pages 등)에서는 /api/news가 없으므로 저장값 무시
                // fall through to defaults below
            } else {
                if (s && s.trim()) return s;
            }
        }
        // Fallback to vercel api if on vercel, otherwise use supabase
        if (window.location.hostname.includes('vercel.app')) return '/api/news';
        return `${SUPABASE_URL}/functions/v1/news`;
    } catch {
        return `${SUPABASE_URL}/functions/v1/news`;
    }
}
window.updateNewsProxySetting = function() {
    const input = document.getElementById('news-proxy-input');
    const url = (input?.value || '').trim();
    try {
        if (url) {
            try {
                const u = new URL(url);
                if (!/^https?:$/i.test(u.protocol)) throw new Error('bad protocol');
            } catch {
                showToast('올바른 주소를 대시오 (http/https).', 'error');
                return;
            }
            localStorage.setItem('news_proxy_url', url);
        }
        else localStorage.removeItem('news_proxy_url');
        showToast('뉴스 프록시가 기록되었소.', 'success');
        loadNews();
    } catch { showToast('기록에 차질이 생겼소.', 'error'); }
};
function parseRssItems(xml) {
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const item = m[1];
        const pick = (tag) => {
            const mm = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
            const v = mm ? mm[1] : '';
            return v.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim();
        };
        items.push({
            title: pick('title'),
            link: pick('link'),
            source: pick('source'),
            published_at: pick('pubDate')
        });
    }
    return items;
}
function buildNewsUrl(baseUrl, query) {
    const q = query && query.trim() ? query.trim() : '코스피 OR 코스닥 OR 증시';
    if (!baseUrl) return '';
    if (baseUrl.includes('{q}')) return baseUrl.replace('{q}', encodeURIComponent(q));
    if (baseUrl.includes('{{q}}')) return baseUrl.replace('{{q}}', encodeURIComponent(q));
    const joiner = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${joiner}q=${encodeURIComponent(q)}`;
}
function getSupabaseFunctionHeaders() {
    const key = SUPABASE_PUBLISHABLE_KEY || SUPABASE_ANON_KEY;
    if (!key) return {};
    return { apikey: key, Authorization: `Bearer ${key}` };
}
async function fetchWithTimeout(url, timeoutMs, headers) {
    try {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
        const res = await Promise.race([fetch(url, headers ? { headers } : undefined), timeout]);
        if (!res || !res.ok) return [];
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('application/json')) {
            const json = await res.json();
            if (Array.isArray(json)) return json;
            if (Array.isArray(json.items)) return json.items;
            if (Array.isArray(json.data)) return json.data;
            if (json && json.items) return json.items;
            return [];
        }
        const text = await res.text();
        return parseRssItems(text);
    } catch {
        return [];
    }
}
async function fetchNewsJson(query) {
    const q = query && query.trim() ? query.trim() : '코스피 OR 코스닥 OR 증시';
    const rss = 'https://news.google.com/rss/search?hl=ko&gl=KR&ceid=KR:ko&q=' + encodeURIComponent(q);
    const proxyBase = getNewsProxyUrl();
    const proxyUrl = buildNewsUrl(proxyBase, query);
    const urls = [];
    if (proxyUrl) urls.push(proxyUrl);
    urls.push('https://api.allorigins.win/raw?url=' + encodeURIComponent(rss));
    urls.push('https://r.jina.ai/https://news.google.com/rss/search?hl=ko&gl=KR&ceid=KR:ko&q=' + encodeURIComponent(q));
    urls.push('https://r.jina.ai/http://news.google.com/rss/search?hl=ko&gl=KR&ceid=KR:ko&q=' + encodeURIComponent(q));
    for (const url of urls) {
        const isSupabase = url.startsWith(SUPABASE_URL);
        const items = await fetchWithTimeout(url, 8000, isSupabase ? getSupabaseFunctionHeaders() : undefined);
        if (items && items.length) return items;
    }
    try {
        const { data, error } = await client.functions.invoke('news', { body: { q } });
        if (!error && data && Array.isArray(data.items)) return data.items;
    } catch {}
    return [];
}
async function loadNews() {
    await loadNewsList('news-feed', '', 12, '표시할 뉴스가 없소.');
}
function renderNewsItems(items, limit = 50) {
    const list = document.getElementById('news-list');
    if (!list) return;
    list.innerHTML = items.slice(0, limit).map(it => {
        const t = it.title || '';
        const l = it.link || '#';
        const d = it.published_at ? new Date(it.published_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        return `<div class="row-item pressable">
            <a href="${l}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-between gap-3 group w-full">
                <span class="text-[13px] text-gray-200 group-hover:text-yellow-400 line-clamp-1">${t}</span>
                <span class="ml-2 flex-shrink-0 text-[10px] text-gray-500 whitespace-nowrap">${d}</span>
            </a>
        </div>`;
    }).join('');
}
async function loadNewsView() {
    const q = (document.getElementById('news-query-input')?.value || '').trim();
    await loadNewsList('news-list', q, 50, '표시할 뉴스가 없소.', true);
}
window.refreshNewsView = function() { loadNewsView(); };
async function loadNewsList(containerId, query, limit, emptyMsg, showLoadingText = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const cacheKey = (query || '').trim();
    const cached = state.newsCache?.[cacheKey];
    const reqId = (state.newsRequestId?.[containerId] || 0) + 1;
    state.newsRequestId[containerId] = reqId;
    if (cached && Array.isArray(cached.items) && cached.items.length) {
        const html = cached.items.slice(0, limit).map(it => {
            const t = it.title || '';
            const l = it.link || '#';
            const d = it.published_at ? new Date(it.published_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
            return `<div class="row-item pressable">
                <a href="${l}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-between gap-3 group w-full">
                    <span class="text-[13px] text-gray-200 group-hover:text-yellow-400 line-clamp-1">${t}</span>
                    <span class="ml-2 flex-shrink-0 text-[10px] text-gray-500 whitespace-nowrap">${d}</span>
                </a>
            </div>`;
        }).join('');
        container.innerHTML = html;
    } else if (containerId === 'news-feed') {
        container.innerHTML = Array.from({ length: 4 }).map(() => `
            <div class="animate-pulse bg-[#1C1C1E] border border-gray-800 rounded-2xl p-4">
                <div class="h-2 bg-gray-800 rounded w-1/4 mb-3"></div>
                <div class="h-3 bg-gray-800 rounded w-full mb-2"></div>
                <div class="h-3 bg-gray-800 rounded w-2/3"></div>
            </div>
        `).join('');
    } else if (showLoadingText) {
        container.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">불러오는 중...</div>';
    }
    try {
        const itemsRaw = await fetchNewsJson(query);
        if (state.newsRequestId[containerId] !== reqId) return;
        const items = itemsRaw.sort((a,b)=>{
            const ta = a.published_at ? Date.parse(a.published_at) : 0;
            const tb = b.published_at ? Date.parse(b.published_at) : 0;
            return tb - ta;
        });
        if (!state.newsCache) state.newsCache = {};
        state.newsCache[cacheKey] = { items, ts: Date.now() };
        if (!items.length) {
            container.innerHTML = `<div class="text-center text-gray-500 py-6 text-xs">${emptyMsg}</div>`;
            return;
        }
        const html = items.slice(0, limit).map(it => {
            const t = it.title || '';
            const l = it.link || '#';
            const d = it.published_at ? new Date(it.published_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
            return `<div class="row-item pressable">
                <a href="${l}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-between gap-3 group w-full">
                    <span class="text-[13px] text-gray-200 group-hover:text-yellow-400 line-clamp-1">${t}</span>
                    <span class="ml-2 flex-shrink-0 text-[10px] text-gray-500 whitespace-nowrap">${d}</span>
                </a>
            </div>`;
        }).join('');
        container.innerHTML = html;
    } catch {
        container.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">접근에 차질이 있소.</div>';
    }
}
function renderSparkline(elId, values, up = true) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!Array.isArray(values) || values.length < 2) { el.innerHTML = ''; return; }
    const w = 160, h = 32, pad = 2;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const toX = (i) => pad + (i / (values.length - 1)) * (w - pad * 2);
    const toY = (v) => pad + (h - pad * 2) - ((v - min) / span) * (h - pad * 2);
    const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
    const color = up ? '#ef4444' : '#60a5fa';
    el.innerHTML = `
        <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
            <path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
    `;
}
async function loadMiniTrends() {
    // Yahoo Finance API via CORS proxy (e.g. allorigins or corsproxy.io)
    // Symbol: ^KS11 (KOSPI), ^KQ11 (KOSDAQ)
    const fetchRealData = async (symbol) => {
        try {
            // Use Yahoo Finance query via corsproxy.io
            // https://query1.finance.yahoo.com/v8/finance/chart/^KS11?interval=1d&range=1d
            const url = `https://corsproxy.io/?` + encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`);
            const res = await fetch(url);
            if (!res.ok) throw new Error('Network error');
            const json = await res.json();
            const result = json.chart.result[0];
            const meta = result.meta;
            const price = meta.regularMarketPrice;
            const prev = meta.chartPreviousClose;
            const change = price - prev;
            const percent = (change / prev) * 100;
            return {
                point: price.toFixed(2),
                change: change.toFixed(2),
                percent: percent.toFixed(2)
            };
        } catch (e) {
            console.warn('Market data fetch failed, using fallback', e);
            // Fallback: Random mock data close to real values
            const base = symbol === '^KS11' ? 2650 : 870;
            const ch = (Math.random() * 10 - 5);
            return {
                point: (base + ch).toFixed(2),
                change: ch.toFixed(2),
                percent: ((ch/base)*100).toFixed(2)
            };
        }
    };

    const updateUI = (id, data) => {
        const el = document.getElementById(id);
        if (!el) return;
        const isUp = parseFloat(data.change) >= 0;
        const colorClass = isUp ? 'text-red-500' : 'text-blue-500';
        const sign = isUp ? '▲' : '▼';
        
        el.innerText = data.point;
        
        // Find change element (next sibling in DOM structure)
        // Structure: div > span(point) + div(change)
        const parent = el.parentElement;
        const changeEl = parent.querySelector('.text-xs'); // Target the change text container
        
        if (changeEl) {
            changeEl.className = `text-xs font-bold ${colorClass} flex items-center gap-1`;
            changeEl.innerHTML = `${sign} ${Math.abs(data.change)} (${Math.abs(data.percent)}%)`;
        }
    };

    const k = await fetchRealData('^KS11');
    const q = await fetchRealData('^KQ11');
    updateUI('mini-kospi', k);
    updateUI('mini-kosdaq', q);
}

function initTicker() {
    const ticker = document.getElementById('main-ticker');
    if (!ticker) return;

    const newsItems = [
        "속보: 무림맹, 신규 투자 비급 공개 예정",
        "삼성전자, 3분기 실적 발표 임박... 강호의 이목 집중",
        "비트코인, 천하제일무술대회 우승 상금으로 채택되나?",
        "천금문 방장: '투자는 심법이 9할이다' 강조",
        "K-배터리 3사, 북미 시장 공략 가속화",
        "개인 투자자 예탁금 50조 돌파, 유동성 장세 기대",
        "미 연준, 금리 동결 시사... 시장 안도감 확산",
        "엔비디아 급등에 반도체 관련주 동반 상승",
        "오늘의 추천 비급: '하락장에서 살아남는 법'",
        "암천 객잔, 신규 메뉴 '상한가주' 출시?!"
    ];

    const stockItems = [
        { name: "삼성전자", price: "72,500", rate: "+1.2%" },
        { name: "SK하이닉스", price: "118,000", rate: "+2.5%" },
        { name: "LG에너지솔루션", price: "480,000", rate: "-0.5%" },
        { name: "POSCO홀딩스", price: "560,000", rate: "+3.1%" },
        { name: "현대차", price: "198,000", rate: "+0.8%" },
        { name: "NAVER", price: "210,000", rate: "-1.1%" },
        { name: "카카오", price: "48,500", rate: "-0.3%" },
        { name: "에코프로", price: "980,000", rate: "+5.4%" }
    ];

    // Combine and shuffle
    const items = [];
    
    // Add stock items first
    stockItems.forEach(s => {
        const isUp = s.rate.includes('+');
        const colorClass = isUp ? 'up' : 'down'; 
        items.push(`<span style="color:#aaa;">${s.name}</span> <span class="${colorClass}">${s.price} (${s.rate})</span>`);
    });

    // Add news items
    newsItems.forEach(n => {
        items.push(`<span style="color:#fbbf24;">[뉴스]</span> ${n}`);
    });

    // Shuffle simple
    items.sort(() => Math.random() - 0.5);

    ticker.innerHTML = items.map(html => `<div class="ticker__item">${html}</div>`).join('');
}

// Call initTicker when init runs or DOM loaded
document.addEventListener('DOMContentLoaded', () => {
    initTicker();
    // Refresh ticker every 5 minutes to simulate updates? 
    // Animation is CSS based, so changing content might reset it.
    // Better to just leave it.
});

// ------------------------------------------------------------------
// 3. 인증 (Auth)
// ------------------------------------------------------------------

let currentAuthMode = 'login'; // 'login' or 'signup'

window.switchAuthTab = function(mode) {
    currentAuthMode = mode;
    const loginTab = document.getElementById('tab-login');
    const signupTab = document.getElementById('tab-signup');
    const signupFields = document.getElementById('signup-fields');
    const submitBtn = document.getElementById('auth-submit-btn');

    if (mode === 'login') {
        loginTab.className = 'flex-1 pb-3 text-sm font-bold text-white border-b-2 border-white transition';
        signupTab.className = 'flex-1 pb-3 text-sm font-bold text-gray-500 border-b-2 border-transparent transition hover:text-gray-300';
        signupFields.classList.add('hidden');
        submitBtn.innerText = '입문';
        submitBtn.className = 'w-full py-3.5 text-sm bg-white text-black rounded-xl font-bold hover:bg-gray-200 transition mb-4';
    } else {
        signupTab.className = 'flex-1 pb-3 text-sm font-bold text-white border-b-2 border-white transition';
        loginTab.className = 'flex-1 pb-3 text-sm font-bold text-gray-500 border-b-2 border-transparent transition hover:text-gray-300';
        signupFields.classList.remove('hidden');
        submitBtn.innerText = '문파 등록';
        submitBtn.className = 'w-full py-3.5 text-sm bg-yellow-600 text-white rounded-xl font-bold hover:bg-yellow-500 transition mb-4';
    }
}

window.submitAuth = function() {
    handleAuth(currentAuthMode === 'signup');
}

async function handleAuth(isSignUp) {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    
    if (!email || !password) {
        showToast('이메일과 암호를 입력하시오.', 'error'); 
        return;
    }

    if (password.length < 6) {
        showToast('암호는 최소 6자 이상이어야 하오.', 'error');
        return;
    }

    // 회원가입 시 추가 검증
    if (isSignUp) {
        const passwordConfirm = document.getElementById('auth-password-confirm').value;
        if (password !== passwordConfirm) {
            showToast('암호가 일치하지 않소.', 'error');
            return;
        }
        const agreed = document.getElementById('term-agree-chk').checked;
        if (!agreed) {
            showToast('강호의 규율에 동의해야 하오.', 'error');
            return;
        }
    }

    let error;
    if (isSignUp) {
        ({ error } = await client.auth.signUp({ email, password }));
    } else {
        ({ error } = await client.auth.signInWithPassword({ email, password }));
    }

    if (error) {
        showToast(`입문에 차질이 생겼소: ${error.message}`, 'error');
    } else {
        if(isSignUp) {
            closeModal('authModal');
            openModal('emailVerificationModal');
        } else {
            console.log('성공적으로 강호에 입문하였소!');
            closeModal('authModal');
            checkSession();
        }
    }
}

async function sendPasswordReset() {
    const email = document.getElementById('reset-email').value;
    if (!email) {
        showToast('등록된 이메일 주소를 대시오.', 'error');
        return;
    }
    
    const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.href,
    });

    if (error) {
        showToast(`발송에 차질이 생겼소: ${error.message}`, 'error');
    } else {
        showToast('암호 재설정 서신을 보냈소.', 'success');
        closeModal('forgotPasswordModal');
    }
}

async function logout() {
    await client.auth.signOut();
    state.profile = null;
    state.user = null;
    updateHeaderUI();
    navigate('gangho-plaza');
    console.log('하산했습니다.');
}

async function checkSession() {
    const { data: { session } } = await client.auth.getSession();
    updateAuthState(session);
    
    client.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
            openModal('changePasswordModal');
        }
        updateAuthState(session);
    });
}

window.submitChangePassword = async function() {
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-new-password').value;
    
    if (newPassword.length < 6) return showToast('암호는 6자 이상이어야 하오.', 'error');
    if (newPassword !== confirmPassword) return showToast('암호가 일치하지 않소.', 'error');
    
    const { error } = await client.auth.updateUser({ password: newPassword });
    
    if (error) {
        showToast('암호 변경에 차질이 생겼소: ' + error.message, 'error');
    } else {
        showToast('암호가 변경되었소.', 'success');
        closeModal('changePasswordModal');
        // Optional: Redirect to home if needed, but we are already there
    }
}

async function updateAuthState(session) {
    state.user = session ? session.user : null;
    if (state.user) {
        const { data } = await client.from('profiles').select('*').eq('id', state.user.id).single();
        if (data) state.profile = data;
        else state.profile = { nickname: '새로운 협객', post_count: 0, comment_count: 0 };
        const theme = state.profile?.theme_style || 'dark';
        document.documentElement.setAttribute('data-theme', theme);
        
        checkUnreadMessages();
        setupRealtimeMessages();
        
        // New features init
        if (typeof fetchMyLikes === 'function') await fetchMyLikes();
        if (typeof checkUnreadNotifications === 'function') checkUnreadNotifications();
        if (typeof setupRealtimeNotifications === 'function') setupRealtimeNotifications();
        await fetchMyRelationships();

        // Show My Page button
        const navBtn = document.getElementById('nav-my-page');
        if (navBtn) navBtn.classList.remove('hidden');
    } else {
        state.profile = null;
        state.likedPostIds = new Set();
        state.relationships = { follows: new Set(), blocks: new Set(), mutes: new Set() };
        document.documentElement.setAttribute('data-theme', 'dark');
        setupRealtimeMessages();
        
        // Hide My Page button
        const navBtn = document.getElementById('nav-my-page');
        if (navBtn) navBtn.classList.add('hidden');
    }
    const adminBtn = document.getElementById('admin-btn');
    if (adminBtn) {
        if (state.profile?.role === 'admin') adminBtn.classList.remove('hidden');
        else adminBtn.classList.add('hidden');
    }
    updateHeaderUI();
}

function updateHeaderUI() {
    ['auth-buttons', 'auth-buttons-mob'].forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;
        if (state.user && state.profile) {
            container.innerHTML = `<button onclick="logout()" class="text-xs bg-red-900/50 text-red-200 px-3 py-1.5 rounded-xl hover:bg-red-900 transition font-bold">하산</button>`;
        } else {
            container.innerHTML = `
                <button onclick="openModal('authModal')" class="text-xs bg-yellow-600 text-black px-4 py-2 rounded-xl font-black hover:bg-yellow-500 transition shadow-lg">
                    입문
                </button>
            `;
        }
    });
}

window.toggleHeaderMenu = function(force) {
    const menu = document.getElementById('header-menu');
    if (!menu) return;
    const wantShow = force === true || (force !== false && menu.classList.contains('hidden'));
    menu.classList.toggle('hidden', !wantShow);
    if (wantShow) {
        const onDocClick = (e) => {
            if (!menu.contains(e.target)) {
                menu.classList.add('hidden');
                document.removeEventListener('click', onDocClick);
            }
        };
        setTimeout(() => document.addEventListener('click', onDocClick), 0);
    }
};

// ------------------------------------------------------------------
// 4. 이미지/미디어 처리
// ------------------------------------------------------------------

async function toWebpBlob(file, maxDim = 1920, quality = 0.85) {
    const url = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
    URL.revokeObjectURL(url);
    return blob;
}

function validateImageFile(file, maxMb = 5) {
    if (!file) return { ok: false, message: '이미지를 선택하시오.' };
    if (!file.type || !file.type.startsWith('image/')) return { ok: false, message: '이미지 파일만 가능하오.' };
    const max = maxMb * 1024 * 1024;
    if (file.size > max) return { ok: false, message: `${maxMb}MB 이하만 가능하오.` };
    return { ok: true };
}

function storagePathFromUrl(publicUrl) {
    const m = publicUrl.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (!m) return null;
    const bucket = m[1];
    const path = m[2];
    if (bucket !== STORAGE_BUCKET) return null;
    return path;
}

async function deleteStorageFileByUrl(publicUrl) {
    const path = storagePathFromUrl(publicUrl);
    if (!path) return;
    try {
        await client.storage.from(STORAGE_BUCKET).remove([path]);
    } catch (e) {
        console.warn('Storage 삭제 실패:', e);
    }
}

async function uploadImage(file, folderPath) {
    const isImg = file.type && file.type.startsWith('image/');
    let blob = file;
    let ext = isImg ? 'webp' : (file.name.split('.').pop() || 'bin');
    if (isImg && file.type !== 'image/webp') {
        blob = await toWebpBlob(file);
        ext = 'webp';
    }
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;
    const filePath = `${folderPath}/${fileName}`;
    
    const { data, error } = await client.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, blob, { 
            cacheControl: '3600',
            upsert: false,
            contentType: isImg ? 'image/webp' : file.type || 'application/octet-stream'
        });

    if (error) {
        console.error('Storage Upload Error:', error);
        throw error;
    } else {
        const publicUrl = client.storage.from(STORAGE_BUCKET).getPublicUrl(data.path).data.publicUrl;
        return publicUrl;
    }
}

window.handleImageUpload = async function() {
    if (!state.user) {
        showToast('화폭 게재는 입문한 협객만 가능하오.', 'error');
        return;
    }
    
    const fileInput = document.getElementById('image-upload-input');
    const file = fileInput.files[0];
    if (!file) return;
    const chk = validateImageFile(file, 5);
    if (!chk.ok) {
        showToast(chk.message, 'error');
        fileInput.value = '';
        return;
    }
    
    try {
        const publicUrl = await uploadImage(file, 'posts');
        const editor = document.getElementById('new-post-content');
        const imgTag = `<img src="${publicUrl}" class="max-w-full h-auto rounded-lg shadow-md my-3" loading="lazy">`;
        insertHtmlAtSelection(imgTag);
    } catch (error) {
        showToast(`화폭 게재에 차질이 생겼소: ${error.message}`, 'error');
    } finally {
        fileInput.value = '';
    }
};

function extractImageStoragePathsFromHtml(html) {
    const container = document.createElement('div');
    container.innerHTML = html || '';
    const imgs = Array.from(container.querySelectorAll('img'));
    const paths = imgs.map(img => storagePathFromUrl(img.src)).filter(p => !!p && p.startsWith('posts/'));
    return Array.from(new Set(paths));
}

window.openYouTubeModal = function() {
    document.getElementById('youtube-url-input').value = '';
    openModal('youtubeEmbedModal');
}

window.handleYouTubeEmbedFromModal = function() {
    const url = document.getElementById('youtube-url-input').value.trim();
    closeModal('youtubeEmbedModal');
    if (!url) return;

    let videoId;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) {
        videoId = match[2];
    } else {
        showToast('유효한 영상 서신이 아니오.', 'error');
        return;
    }

    const embedHtml = `<div class="my-4 w-full" style="aspect-ratio: 16 / 9;"><iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen class="rounded-lg shadow-xl w-full h-full"></iframe></div>`;
    const editor = document.getElementById('new-post-content');
    document.execCommand('insertHTML', false, embedHtml);
};

// ------------------------------------------------------------------
// 5. 게시글 CRUD & 검색
// ------------------------------------------------------------------

function autoSavePost() {
    if (state.isEditing) return; 
    const title = document.getElementById('new-post-title').value;
    const content = document.getElementById('new-post-content').innerHTML;
    const type = document.querySelector('input[name="post-type"]:checked').value;
    
    if (!title && !content) return;

    localStorage.setItem('temp_post_title', title);
    localStorage.setItem('temp_post_content', content);
    localStorage.setItem('temp_post_type', type);
    
    const indicator = document.getElementById('autosave-indicator');
    if(indicator) {
        indicator.innerText = '기록됨';
        indicator.classList.remove('opacity-0');
        setTimeout(() => indicator.classList.add('opacity-0'), 2000);
    }
}

function clearTempPost() {
    localStorage.removeItem('temp_post_title');
    localStorage.removeItem('temp_post_content');
    localStorage.removeItem('temp_post_type');
}

function checkAndLoadTempPost() {
    if (state.isEditing) return;

    const title = localStorage.getItem('temp_post_title');
    const content = localStorage.getItem('temp_post_content');
    const type = localStorage.getItem('temp_post_type');

    if (title || (content && content.trim() !== '')) {
        if(confirm('집필 중이던 비급이 있소. 다시 펼치시겠소?')) {
            document.getElementById('new-post-title').value = title || '';
            document.getElementById('new-post-content').innerHTML = content || '';
            if(type) {
                const radio = document.getElementById(`type-${type}`);
                if(radio) {
                    radio.checked = true;
                    togglePostTypeFields(type);
                }
            }
        }
    }
}

async function savePost() {
    const type = document.querySelector('input[name="post-type"]:checked').value;
    if (type !== 'secret' && !state.user) return showToast('입문 후 이용 가능하오.', 'error');
    if (state.user && state.profile?.is_banned) return showToast('관문 출입 금지 상태이오.', 'error');

    const title = document.getElementById('new-post-title').value;
    const contentHTMLRaw = document.getElementById('new-post-content').innerHTML.trim();
    const contentHTML = linkifyHtml(contentHTMLRaw, false);

    if (!title || !contentHTML) return showToast('제목과 내용을 채우시오.', 'error');
    if (containsBadWords(title) || containsBadWords(contentHTMLRaw)) return showToast('금칙어가 포함되었소.', 'error');

    let stockName = null;
    if (type === 'stock') {
        stockName = document.getElementById('stock-input').value.trim();
        if (!stockName) return showToast('종목명을 명시하시오.', 'error');

        if (!state.isEditing) {
            const { data } = await client.from('stock_tags').select('name').eq('name', stockName);
            const rows = Array.isArray(data) ? data : [];
            if (rows.length === 0) {
                await client.from('stock_tags').insert({ name: stockName });
                await fetchStockTags();
            }
        }
    }

    // 암천객잔 제한 체크
    if (type === 'secret' && !state.user) {
        const today = new Date().toISOString().split('T')[0];
        const count = parseInt(localStorage.getItem(`post_count_${today}`) || '0');
        if (count >= 3) return showToast('하루에 세 편의 익명 비급만 허용되오.', 'error');
    }

    if (!state.isEditing) {
        const key = `post_cooldown_${state.user ? state.user.id : 'guest'}`;
        const last = parseInt(localStorage.getItem(key) || '0');
        const now = Date.now();
        const minGap = state.user ? 15000 : 30000;
        if (now - last < minGap) return showToast('너무 빠르오. 잠시 후 다시 시도하오.', 'error');
    }

    const payload = {
        title, content: contentHTML, type, 
        stock_id: stockName,
        category: type === 'stock' ? (document.getElementById('post-category-select')?.value || null) : null,
        mugong_id: type === 'public' ? document.getElementById('mu-gong-select').value : null,
    };

    let error;
    
    if (state.isEditing) {
        if(!state.user) return showToast('익명 비급은 고쳐쓸 수 없소.', 'error');
        const { error: updateError } = await client.from('posts').update(payload).eq('id', state.currentPostId).eq('user_id', state.user.id);
        error = updateError;
    } else {
        payload.user_id = state.user ? state.user.id : null;
        payload.guest_nickname = state.user ? null : `무협객(${Math.floor(Math.random()*1000)})`;
        payload.guest_device_id = state.user ? null : getGuestDeviceId();
        payload.view_count = 0;
        payload.like_count = 0;
        const { error: insertError } = await client.from('posts').insert(payload);
        error = insertError;
    }

    if (error) {
        console.error(`실패:`, error);
        const m = (error.message || '').toLowerCase();
        if (m.includes('row level security') || m.includes('with check')) {
            showToast('비급 제한에 걸렸소. 잠시 후 다시 시도하오.', 'error');
            logRateLimit('post_insert', error.message || 'rls');
        } else {
            showToast('비급 보관 중 차질이 생겼소.', 'error');
        }
    } else {
        if(!state.isEditing) clearTempPost();

        if (!state.isEditing) {
            const key = `post_cooldown_${state.user ? state.user.id : 'guest'}`;
            localStorage.setItem(key, String(Date.now()));
        }
        
        if (type === 'secret' && !state.user) {
            const today = new Date().toISOString().split('T')[0];
            const currentCount = parseInt(localStorage.getItem(`post_count_${today}`) || '0');
            localStorage.setItem(`post_count_${today}`, currentCount + 1);
        }

        closeModal('newPostModal');
        showToast('비급이 강호에 전파되었소.', 'success');
        if (type === 'stock') {
            state.currentStockName = stockName; 
            navigate('stock-board');
        } else {
            navigate(document.querySelector('.app-view:not(.hidden)').id);
        }
    }
}

window.deletePost = async function(postId) {
    closeModal('deleteConfirmModal');
    if (!postId || !state.user) return;
    
    const html = state.postToEdit?.content || '';
    const imagePaths = extractImageStoragePathsFromHtml(html);
    
    let query = client.from('posts').delete().eq('id', postId);
    if (state.profile?.role !== 'admin') {
        query = query.eq('user_id', state.user.id);
    }
    const { error } = await query;
    
    if (error) {
        showToast('파기 권한이 없거나 문제가 생겼소.', 'error');
    } else {
        showToast('비급이 파기되었소.', 'success');
        if (imagePaths.length > 0) {
            try {
                await client.storage.from(STORAGE_BUCKET).remove(imagePaths);
            } catch (e) {
                console.warn('비급 첨부 이미지 삭제 실패:', e);
            }
        }
        navigate('gangho-plaza');
    }
}

// ------------------------------------------------------------------
// 6. UI: 네비게이션 & 렌더링
// ------------------------------------------------------------------

let miniTrendsInterval = null;

async function navigate(viewId, pushHistory = true) {
    const useHashRouting = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (pushHistory) {
        // 로컬 파일 프로토콜(file://)에서는 history.pushState 사용 시 보안 오류 발생 가능
        // 따라서 http/https 프로토콜일 때만 실행하거나 try-catch로 감싸야 함
        if (window.location.protocol.startsWith('http')) {
            if (useHashRouting) history.pushState({ viewId }, '', `#${viewId}`);
            else history.pushState({ viewId }, '', `/${viewId}`);
        } else {
            // 로컬 개발 환경용 폴백 (해시 사용)
            // history.pushState({ viewId }, '', `#${viewId}`);
            // 또는 단순 상태 저장만 수행
            try {
                history.pushState({ viewId }, '', `#${viewId}`);
            } catch(e) {
                console.warn('History API not supported in this environment');
            }
        }
    }
    
    // SEO: Update Meta Tags based on view
    updateMetaTagsForView(viewId);

    // Handle initial popstate
    if (!window.onpopstate) {
        window.onpopstate = function(event) {
            if (event.state && event.state.viewId) {
                navigate(event.state.viewId, false);
            } else {
                navigate('gangho-plaza', false);
            }
        };
    }

    try {
        const currentViewEl = document.querySelector('.app-view:not(.hidden)');
        if (currentViewEl) {
            state.scrollPositions[currentViewEl.id] = window.pageYOffset || document.documentElement.scrollTop || 0;
        }
    } catch {}
    document.querySelectorAll('.app-view').forEach(el => el.classList.add('hidden'));
    const targetEl = document.getElementById(viewId);
    if (targetEl) targetEl.classList.remove('hidden');

    // Update Mobile Header Title
    const mobileHeaderTitle = document.getElementById('mobile-header-title');
    if (mobileHeaderTitle) {
        const item = MENU_ITEMS.find(m => m.id === viewId);
        mobileHeaderTitle.innerText = item ? item.label : '千金門';
    }

    document.querySelectorAll('.nav-btn, .nav-item').forEach(btn => {
        btn.setAttribute('aria-selected', 'false');
        btn.classList.remove('active'); // For mobile nav styling compatibility
        // Desktop nav-item active style (optional if CSS uses aria-selected)
        if (btn.classList.contains('nav-item')) {
            btn.classList.remove('text-white', 'bg-gray-800');
            btn.classList.add('text-gray-400');
        }
    });

    const activeBtns = document.querySelectorAll(`[data-target="${viewId}"]`);
    activeBtns.forEach(btn => {
        btn.setAttribute('aria-selected', 'true');
        btn.classList.add('active'); // For mobile nav
        // Desktop nav-item active style
        if (btn.classList.contains('nav-item')) {
            btn.classList.remove('text-gray-400');
            btn.classList.add('text-white', 'bg-gray-800');
        }
    });

    if (pushHistory && window.location.protocol.startsWith('http')) {
        // Remove duplicate pushState (already handled at top)
        // window.history.pushState({ viewId }, null, `#${viewId}`);
    }

    const footer = document.getElementById('site-footer');
    if (footer) footer.classList.toggle('hidden', viewId === 'post-detail');
    if (viewId !== 'post-detail') {
        try {
            Object.keys(state.realtimeChannels || {}).filter(k => k.startsWith('comments_')).forEach(k => {
                client.removeChannel(state.realtimeChannels[k]);
                delete state.realtimeChannels[k];
            });
        } catch {}
    }
    try {
        const restore = state.scrollPositions[viewId];
        if (typeof restore === 'number') {
            window.scrollTo({ top: restore, behavior: 'instant' });
        } else {
            window.scrollTo({ top: 0, behavior: 'instant' });
            const mainEl = document.querySelector('main');
            if (mainEl) mainEl.scrollTop = 0;
        }
    } catch {}

    if (miniTrendsInterval) {
        clearInterval(miniTrendsInterval);
        miniTrendsInterval = null;
    }

    if (viewId === 'gangho-plaza') {
        renderPosts('posts-list-public', 'public');
        loadNews();
        loadMiniTrends();
        miniTrendsInterval = setInterval(loadMiniTrends, 60_000);
        loadJournalFeed();
        loadWeeklyDigest();
        loadRookieSpotlight();
        renderRecentStocksHome();
        renderHomeStockRank('today');
    }
    if (viewId === 'news-view') loadNewsView();
    if (viewId === 'journal-board') loadJournalBoard();
    if (viewId === 'stock-board') {
        if(state.stockTags.length === 0) fetchStockTags();
        else {
            if (!state.stocksMaster.length) { try { await fetchStocksMaster(); } catch {} }
            renderStockTabs();
            renderRecentStocks();
            renderHotRooms();
            try { if (state.profile?.role === 'admin' && !localStorage.getItem('cat_backfill_done')) { await client.rpc('backfill_post_categories'); localStorage.setItem('cat_backfill_done', '1'); } } catch {}
            updateCurrentStockHeader();
            const clr = document.getElementById('clear-stock-btn');
            if (clr) clr.onclick = () => setCurrentStock(null);
            attachStockAutocomplete();
            setStockSortMode(state.stockSortMode || 'latest');
            renderPosts('posts-list-stock', 'stock', state.currentStockName);
        }
    }
    if (viewId === 'secret-inn') renderPosts('posts-list-secret', 'secret');
    if (viewId === 'my-page') renderMyPage();
    if (viewId === 'materials-board') loadMaterialsBoard();
    setupRealtimePostsForView();
    trackRecentMenu(viewId);
    renderRecentMenuBar();
}
window.navigate = navigate;

const MENU_ITEMS = [
    { id: 'gangho-plaza', label: '강호광장', icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>' },
    { id: 'stock-board', label: '종목비급', icon: '<line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>' },
    { id: 'journal-board', label: '매매일지', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line>' },
    { id: 'news-view', label: '증권뉴스', icon: '<path d="M19 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1m2 13a2 2 0 0 1-2-2V7m2 13a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"></path>' },
    { id: 'secret-inn', label: '암천객잔', icon: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>' },
    { id: 'free-board', label: '자유게시판', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>' },
    { id: 'materials-board', label: '강의자료', icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>' },
    { id: 'profit-cert', label: '수익인증', icon: '<polyline points="20 6 9 17 4 12"></polyline>' },
    { id: 'notice-board', label: '공지사항', icon: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>' },
    { id: 'welcome-board', label: '가입인사', icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>' },
    { id: 'market-today', label: '오늘의시황', icon: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>' },
    { id: 'kiwoom-catch', label: '키움캐치', icon: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>' },
    { id: 'humor-board', label: '오늘의유머', icon: '<circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line>' },
    { id: 'debate-board', label: '오늘의토론', icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>' },
    { id: 'music-board', label: '음악이야기', icon: '<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>' },
    { id: 'travel-board', label: '여행탐방', icon: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>' },
    { id: 'event-board', label: '이벤트', icon: '<path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"></path><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"></path><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"></path>' }
];

const MENU_ICONS = {};

function renderMegaMenu() {
    // Removed legacy menu
}

function trackRecentMenu(viewId) {
    if (viewId === 'post-detail') return;
    const key = 'recent_menus';
    let list;
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { list = []; }
    const valid = MENU_ITEMS.some(m => m.id === viewId);
    if (!valid) return;
    list = [viewId].concat(list.filter(id => id !== viewId));
    list = list.slice(0, 8);
    try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
}

function renderRecentMenuBar() {
    // Removed legacy menu
}

function getFavorites() {
    try { return JSON.parse(localStorage.getItem('fav_menus') || '[]'); } catch { return []; }
}
function setFavorites(list) {
    try { localStorage.setItem('fav_menus', JSON.stringify(list)); } catch {}
}
function toggleFavorite(id) {
    let fav = getFavorites();
    if (fav.includes(id)) fav = fav.filter(x => x !== id);
    else fav = [id].concat(fav);
    setFavorites(fav);
    renderMenuPalette();
}
function createMenuChip(id, label) {
    const item = MENU_ITEMS.find(m => m.id === id);
    const iconSvg = item ? item.icon : '<circle cx="12" cy="12" r="10"></circle>';
    
    const btn = document.createElement('button');
    btn.className = 'flex flex-col items-center justify-center p-3 bg-[#1C1C1E] rounded-xl border border-gray-800 hover:bg-gray-800 transition aspect-square relative group';
    
    const iconContainer = document.createElement('div');
    iconContainer.className = 'w-8 h-8 flex items-center justify-center text-gray-300 group-hover:text-yellow-400 transition-colors mb-2';
    iconContainer.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${iconSvg}</svg>`;
    
    const txt = document.createElement('span');
    txt.className = 'text-[10px] text-gray-200 font-medium group-hover:text-yellow-400 text-center leading-tight';
    txt.textContent = label;
    
    // Star (Favorite) button
    const star = document.createElement('button');
    star.className = 'absolute top-1 right-1 p-1 opacity-0 group-hover:opacity-100 transition-opacity';
    const isFav = getFavorites().includes(id);
    star.innerHTML = isFav 
        ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" class="text-yellow-500"><path d="M12 .587l3.668 7.431 8.2 1.193-5.934 5.788 1.402 8.168L12 18.896l-7.336 4.271 1.402-8.168L.132 9.211l8.2-1.193z"></path></svg>'
        : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="text-gray-600 hover:text-yellow-500" stroke-width="2"><path d="M12 .587l3.668 7.431 8.2 1.193-5.934 5.788 1.402 8.168L12 18.896l-7.336 4.271 1.402-8.168L.132 9.211l8.2-1.193z"></path></svg>';
    if (isFav) star.classList.remove('opacity-0'); // Always show if favorite
    
    star.onclick = (e)=> { e.stopPropagation(); toggleFavorite(id); };
    
    btn.appendChild(iconContainer);
    btn.appendChild(txt);
    btn.appendChild(star);
    btn.onclick = () => { navigate(id); closeModal('menuPaletteModal'); trackRecentMenu(id); };
    return btn;
}
window.openMenuPalette = function() {
    openModal('menuPaletteModal');
    renderMenuPalette();
    const input = document.getElementById('menu-search-input');
    if (input) {
        input.value = '';
        input.oninput = () => renderMenuPalette();
    }
};
function renderMenuPalette() {
    const input = document.getElementById('menu-search-input');
    const q = (input?.value || '').trim().toLowerCase();
    const favWrap = document.getElementById('menu-favorites');
    const recWrap = document.getElementById('menu-recents');
    const allWrap = document.getElementById('menu-all');
    if (!favWrap || !recWrap || !allWrap) return;
    favWrap.innerHTML = '';
    recWrap.innerHTML = '';
    allWrap.innerHTML = '';
    const fav = getFavorites();
    const labelMap = Object.fromEntries(MENU_ITEMS.map(m => [m.id, m.label]));
    fav.forEach(id => {
        if (q && !(labelMap[id] || '').toLowerCase().includes(q)) return;
        favWrap.appendChild(createMenuChip(id, labelMap[id] || id));
    });
    let recents;
    try { recents = JSON.parse(localStorage.getItem('recent_menus') || '[]'); } catch { recents = []; }
    recents.forEach(id => {
        if (q && !(labelMap[id] || '').toLowerCase().includes(q)) return;
        recWrap.appendChild(createMenuChip(id, labelMap[id] || id));
    });
    MENU_ITEMS.forEach(m => {
        if (q && !m.label.toLowerCase().includes(q)) return;
        allWrap.appendChild(createMenuChip(m.id, m.label));
    });
}
async function loadWeeklyDigest() {
    const wrap = document.getElementById('weekly-digest');
    const listEl = document.getElementById('weekly-digest-list');
    if (!wrap || !listEl) return;
    wrap.classList.add('hidden');
    listEl.innerHTML = '<div class="text-[11px] text-gray-500">요약을 모으는 중...</div>';
    try {
        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const { data } = await client.from('posts')
            .select(`id,title,content,created_at,like_count,view_count,profiles:user_id (nickname, avatar_url)`)
            .gte('created_at', since)
            .in('type', ['public','secret'])
            .order('created_at', { ascending: false })
            .limit(100);
        const items = (data || []);
        if (!items.length) { listEl.innerHTML = ''; return; }
        const score = (p) => Math.log1p(Number(p.like_count || 0)) * 2 + Math.log1p(Number(p.view_count || 0));
        const top = items.sort((a, b) => score(b) - score(a)).slice(0, 5);
        listEl.innerHTML = '';
        top.forEach(p => {
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between text-[12px] py-1';
            const left = document.createElement('div');
            left.className = 'flex items-center gap-2 min-w-0';
            const av = document.createElement('img');
            av.src = p.profiles?.avatar_url || '';
            av.className = `w-4 h-4 rounded-full border border-gray-700 ${p.profiles?.avatar_url ? '' : 'hidden'}`;
            const tt = document.createElement('div');
            tt.className = 'truncate text-gray-200';
            tt.textContent = p.title || '(제목 없음)';
            left.appendChild(av);
            left.appendChild(tt);
            const right = document.createElement('div');
            right.className = 'flex items-center justify-between gap-1 text-gray-400 whitespace-nowrap flex-shrink-0 w-[64px]';
            right.innerHTML = `
                <div class="flex items-center gap-[2px]">
                    <span class="text-[9px]">👁</span>
                    <span class="w-5 text-right text-[9px]">${p.view_count || 0}</span>
                </div>
                <div class="flex items-center gap-[2px]">
                    <span class="text-[9px]">❤️</span>
                    <span class="w-5 text-right text-[9px]">${p.like_count || 0}</span>
                </div>`;
            row.appendChild(left);
            row.appendChild(right);
            row.onclick = () => openPostDetail(p);
            listEl.appendChild(row);
        });
        wrap.classList.remove('hidden');
    } catch {
        listEl.innerHTML = '';
    }
}

async function loadRookieSpotlight() {
    const wrap = document.getElementById('rookie-spotlight');
    const listEl = document.getElementById('rookie-spotlight-list');
    if (!wrap || !listEl) return;
    wrap.classList.add('hidden');
    listEl.innerHTML = '<div class="text-[11px] text-gray-500">발굴 중...</div>';
    try {
        const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
        const { data } = await client.from('posts')
            .select(`id,user_id,title,content,created_at,profiles:user_id (nickname, post_count, comment_count, avatar_url)`)
            .gte('created_at', since)
            .in('type', ['public','secret'])
            .order('created_at', { ascending: false })
            .limit(200);
        const items = (data || []).filter(p => {
            const pc = Number(p.profiles?.post_count || 0);
            return pc <= 3;
        }).slice(0, 5);
        listEl.innerHTML = '';
        if (!items.length) { wrap.classList.add('hidden'); return; }
        items.forEach(p => {
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between text-[12px] py-1';
            const left = document.createElement('div');
            left.className = 'flex items-center gap-2 min-w-0';
            const av = document.createElement('img');
            av.src = p.profiles?.avatar_url || '';
            av.className = `w-4 h-4 rounded-full border border-gray-700 ${p.profiles?.avatar_url ? '' : 'hidden'}`;
            const name = document.createElement('div');
            name.className = 'text-gray-400 whitespace-nowrap max-w-[30vw] truncate';
            name.textContent = p.profiles?.nickname || '협객';
            const tt = document.createElement('div');
            tt.className = 'truncate text-gray-200 flex-1 min-w-0';
            tt.textContent = p.title || '(제목 없음)';
            left.appendChild(av);
            left.appendChild(name);
            left.appendChild(tt);
            const right = document.createElement('div');
            right.className = 'flex items-center gap-2 text-gray-400 whitespace-nowrap flex-shrink-0';
            const followBtn = document.createElement('button');
            followBtn.className = 'text-[10px] text-yellow-400 px-2 py-0.5 rounded border border-yellow-700/40 bg-yellow-900/30 whitespace-nowrap shrink-0';
            followBtn.textContent = '팔로우';
            followBtn.onclick = async (e) => {
                e.stopPropagation();
                if (!state.user || !p.user_id) return;
                await toggleRelationship('follow', p.user_id);
                showToast('팔로우했소.', 'success');
            };
            const dateEl = document.createElement('span');
            dateEl.className = 'text-[10px] whitespace-nowrap';
            dateEl.textContent = new Date(p.created_at).toLocaleDateString();
            right.appendChild(followBtn);
            right.appendChild(dateEl);
            row.appendChild(left);
            row.appendChild(right);
            row.onclick = () => openPostDetail(p);
            listEl.appendChild(row);
        });
        wrap.classList.remove('hidden');
    } catch {
        listEl.innerHTML = '';
    }
}

async function loadSponsors() {
    const wrap = document.getElementById('sponsor-section');
    const listEl = document.getElementById('sponsor-list');
    if (!wrap || !listEl) return;
    wrap.classList.add('hidden');
    listEl.innerHTML = '<div class="text-[11px] text-gray-500">후원 정보를 불러오는 중...</div>';
    try {
        const { data } = await client.from('sponsor_slots')
            .select('id,title,label,link_url,image_url,priority,created_at')
            .eq('active', true)
            .order('priority', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(3);
        const items = Array.isArray(data) ? data : [];
        listEl.innerHTML = '';
        if (!items.length) { wrap.classList.add('hidden'); return; }
        items.forEach(s => {
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between text-[12px] cursor-pointer hover:opacity-90 transition';
            const left = document.createElement('div');
            left.className = 'flex items-center gap-2 min-w-0';
            const img = document.createElement('img');
            img.src = s.image_url || '';
            img.className = `w-6 h-6 rounded border border-gray-700 ${s.image_url ? '' : 'hidden'}`;
            const title = document.createElement('div');
            title.className = 'truncate text-gray-200';
            title.textContent = s.title || '스폰서';
            const badge = document.createElement('span');
            badge.className = 'text-[10px] text-gray-400 whitespace-nowrap';
            badge.textContent = s.label || '';
            left.appendChild(img);
            left.appendChild(title);
            if (s.label) left.appendChild(badge);
            const right = document.createElement('div');
            right.className = 'flex items-center gap-2 text-gray-400';
            right.innerHTML = `<span class="text-[10px]">바로가기</span>`;
            row.appendChild(left);
            row.appendChild(right);
            row.onclick = () => {
                try { window.open(s.link_url, '_blank'); } catch {}
            };
            listEl.appendChild(row);
        });
        wrap.classList.remove('hidden');
    } catch {
        listEl.innerHTML = '';
        if (wrap) wrap.classList.add('hidden');
    }
}
document.addEventListener('DOMContentLoaded', () => {
    const qInput = document.getElementById('news-query-input');
    if (qInput) {
        qInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadNewsView(); });
        let t;
        qInput.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => {
                if (document.getElementById('news-view') && !document.getElementById('news-view').classList.contains('hidden')) {
                    loadNewsView();
                }
            }, 500);
        });
    }
    const jd = document.getElementById('journal-date');
    if (jd) {
        const today = new Date().toISOString().split('T')[0];
        jd.value = today;
    }
    const recoToggle = document.getElementById('reco-include-secret-toggle');
    if (recoToggle) {
        try { recoToggle.checked = !!state.includeSecretInReco; } catch {}
        recoToggle.addEventListener('change', () => {
            const on = !!recoToggle.checked;
            window.toggleRecoIncludeSecret(on);
        });
    }
    const recoBalanceToggle = document.getElementById('reco-balance-toggle');
    if (recoBalanceToggle) {
        try { recoBalanceToggle.checked = !!state.recoBalanceEnabled; } catch {}
        recoBalanceToggle.addEventListener('change', () => {
            const on = !!recoBalanceToggle.checked;
            state.recoBalanceEnabled = on;
            try { localStorage.setItem('reco_balance_enabled', JSON.stringify(on)); } catch {}
            if (document.getElementById('gangho-plaza') && !document.getElementById('gangho-plaza').classList.contains('hidden')) {
                loadRecommended();
            }
        });
    }
    const hdrMenu = document.getElementById('header-menu');
    if (hdrMenu) {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('button[onclick*=\"toggleHeaderMenu\"]');
            if (btn) return;
            if (!hdrMenu.classList.contains('hidden') && !hdrMenu.contains(e.target)) {
                hdrMenu.classList.add('hidden');
            }
        });
    }
    try { init(); } catch (e) { console.error('초기화 실패:', e); }
});

window.toggleHeaderMenu = function(force) {
    const menu = document.getElementById('header-menu');
    if (!menu) return;
    const show = typeof force === 'boolean' ? force : menu.classList.contains('hidden');
    if (show) {
        menu.classList.remove('hidden');
    } else {
        menu.classList.add('hidden');
    }
};

window.saveJournalEntry = async function() {
    if (!state.user) return showToast('입문 후 기록 가능하오.', 'error');
    const base = parseFloat(document.getElementById('journal-base').value || '0');
    const profit = parseFloat(document.getElementById('journal-profit').value || '0');
    const date = document.getElementById('journal-date').value || new Date().toISOString().split('T')[0];
    const note = (document.getElementById('journal-note').value || '').trim();
    const strategy = (document.getElementById('journal-strategy').value || '').trim();
    const tags = (document.getElementById('journal-tags').value || '').trim();
    const pub = !!document.getElementById('journal-public').checked;
    if (!base) return showToast('기초 자산을 입력하시오.', 'error');
    const percent = base ? (profit / base) * 100 : 0;
    const payload = {
        user_id: state.user.id,
        entry_date: date,
        base_capital: base,
        profit_amount: profit,
        profit_percent: Math.round(percent * 100) / 100,
        note: note || null,
        is_public: pub
    };
    const { data, error } = await client.from('journal_entries').insert(payload).select('id').single();
    if (error) {
        const m = (error.message || '').toLowerCase();
        if (m.includes('relation') && m.includes('journal_entries')) {
            showToast('스키마가 반영되지 않았소. SQL을 실행하시오.', 'error');
        } else if (m.includes('foreign key') || m.includes('violates')) {
            showToast('프로필이 없어 외래키가 막혔소. 프로필 백필을 실행하시오.', 'error');
        } else if (m.includes('policy') || m.includes('with check') || m.includes('row level security')) {
            showToast('권한 정책(RLS) 문제로 기록 불발.', 'error');
        } else {
            showToast('기록에 차질이 있소.', 'error');
        }
        return;
    }
    document.getElementById('journal-profit').value = '';
    document.getElementById('journal-note').value = '';
    document.getElementById('journal-strategy').value = '';
    document.getElementById('journal-tags').value = '';
    document.getElementById('journal-public').checked = false;
    if ((strategy || tags) && data?.id) {
        await client.from('journal_entries').update({
            strategy: strategy || null,
            tags: tags || null
        }).eq('id', data.id).eq('user_id', state.user.id);
    }
    loadMyJournal();
    if (pub) loadJournalFeed();
}

async function loadMaterialsPreview() {
    const box = document.getElementById('materials-preview');
    if (!box) return;
    box.innerHTML = '<div class="text-[11px] text-gray-500">강의 자료를 불러오는 중...</div>';
    try {
        const { data } = await client.from('materials')
            .select('id,user_id,title,preview,price,created_at,profiles:user_id (nickname, avatar_url)')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(3);
        const items = data || [];
        box.innerHTML = '';
        if (!items.length) return;
        const frag = document.createDocumentFragment();
        items.forEach(m => frag.appendChild(createMaterialRow(m)));
        box.appendChild(frag);
    } catch {
        box.innerHTML = '';
    }
}
async function loadMaterialsBoard() {
    const list = document.getElementById('materials-list');
    if (!list) return;
    list.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">강의 자료를 조회하는 중...</div>';
    try {
        const { data } = await client.from('materials')
            .select('id,user_id,title,preview,price,created_at,profiles:user_id (nickname, avatar_url)')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(50);
        list.innerHTML = '';
        const frag = document.createDocumentFragment();
        (data || []).forEach(m => frag.appendChild(createMaterialRow(m)));
        list.appendChild(frag);
    } catch {
        list.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">불러오기에 차질이 있소.</div>';
    }
}
function createMaterialRow(m) {
    const row = document.createElement('div');
    row.className = 'card cursor-pointer';
    const av = m.profiles?.avatar_url || '';
    const name = m.profiles?.nickname || '협객';
    row.innerHTML = `
        <div class="flex justify-between items-start mb-1">
            <h4 class="text-white font-semibold truncate text-base flex-1">${m.title}</h4>
            <span class="text-[11px] text-yellow-400 ml-2 bg-yellow-900/40 px-1.5 py-0.5 rounded border border-yellow-700/40">${(m.price||0).toLocaleString()}원</span>
        </div>
        <div class="text-[11px] text-gray-300 mb-1 truncate">${m.preview || ''}</div>
        <div class="text-xs text-gray-400 flex justify-between items-center">
            <div class="flex items-center space-x-2">
                <img src="${av}" class="w-5 h-5 rounded-full border border-gray-700 ${av ? '' : 'hidden'}">
                <span class="text-gray-300">${name}</span>
            </div>
            <span class="text-gray-500">${new Date(m.created_at).toLocaleDateString()}</span>
        </div>
    `;
    row.onclick = () => openMaterialDetail(m.id);
    return row;
}
window.openMaterialDetail = async function(materialId) {
    const { data, error } = await client.from('material_contents')
        .select('content, material_id, materials:material_id (id,title,price,user_id)')
        .eq('material_id', materialId)
        .single();
    const container = document.getElementById('post-detail'); // 재사용
    navigate('post-detail');
    const titleEl = document.getElementById('detail-title');
    const contentEl = document.getElementById('detail-content');
    const authorEl = document.getElementById('detail-author');
    const dateEl = document.getElementById('detail-date');
    const likesEl = document.getElementById('detail-likes');
    const viewsEl = document.getElementById('detail-views');
    if (likesEl) likesEl.innerText = 0;
    if (viewsEl) viewsEl.innerText = 0;
    if (error || !data) {
        const { data: meta } = await client.from('materials').select('id,title,price,created_at').eq('id', materialId).single();
        if (titleEl) titleEl.innerText = meta?.title || '강의 자료';
        if (contentEl) contentEl.innerHTML = `
            <div class="bg-[#1C1C1E] p-4 rounded-xl border border-gray-800">
                <div class="text-sm text-gray-300 mb-2">구매 후 열람 가능하오. 아래 무통장입금 안내를 따르시오.</div>
                <div class="text-[12px] text-gray-200 bg-black/40 rounded-xl border border-gray-800 p-3 mb-3">
                    <div class="mb-1"><span class="text-gray-400">은행</span> <span class="text-white font-semibold">${BANK_INFO.bank_name}</span></div>
                    <div class="mb-1"><span class="text-gray-400">계좌</span> <span class="text-white font-semibold">${BANK_INFO.account_number}</span></div>
                    <div class="mb-2"><span class="text-gray-400">예금주</span> <span class="text-white font-semibold">${BANK_INFO.owner_name}</span></div>
                    <div class="text-[11px] text-gray-400">${BANK_INFO.message}</div>
                </div>
                <div class="space-y-2">
                    <div>
                        <div class="text-xs text-gray-400 mb-1">입금자명</div>
                        <input id="dep-name" type="text" value="${state.profile?.nickname || ''}" class="w-full bg-black border border-gray-700 rounded-xl px-3 py-2 text-white text-sm">
                    </div>
                    <div>
                        <div class="text-xs text-gray-400 mb-1">입금액(원)</div>
                        <input id="dep-amount" type="number" min="0" step="100" value="${Number(meta?.price || 0)}" class="w-full bg-black border border-gray-700 rounded-xl px-3 py-2 text-white text-sm">
                    </div>
                    <div>
                        <div class="text-xs text-gray-400 mb-1">메모(선택)</div>
                        <input id="dep-memo" type="text" class="w-full bg-black border border-gray-700 rounded-xl px-3 py-2 text-white text-sm">
                    </div>
                </div>
                <div class="flex justify-end mt-3">
                    <button class="text-sm bg-yellow-600 text-black px-3 py-2 rounded-xl font-bold hover:bg-yellow-500 border border-yellow-700" onclick="requestDeposit('${materialId}')">입금 확인 요청</button>
                </div>
            </div>`;
        if (authorEl) authorEl.innerText = '';
        if (dateEl) dateEl.innerText = meta ? new Date(meta.created_at).toLocaleString() : '';
        ['detail-prev-next','detail-prev-next-modal'].forEach(id => {
            const container2 = document.getElementById(id);
            if (!container2) return;
            container2.innerHTML = '';
            const backBtn2 = document.createElement('button');
            backBtn2.className = 'text-[11px] text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-800';
            backBtn2.textContent = '목록으로';
            backBtn2.onclick = () => navigate('materials-board');
            container2.appendChild(backBtn2);
        });
        return;
    }
    const meta = data.materials || {};
    if (titleEl) titleEl.innerHTML = `${meta.title || '강의 자료'} <span class="ml-2 text-[11px] text-green-400 bg-green-900/40 px-1.5 py-0.5 rounded border border-green-700/40">열람 가능</span>`;
    if (contentEl) contentEl.innerHTML = linkifyHtml(data.content || '');
    if (authorEl) authorEl.innerText = '';
    if (dateEl) dateEl.innerText = '';
    ['detail-prev-next','detail-prev-next-modal'].forEach(id => {
        const container2 = document.getElementById(id);
        if (!container2) return;
        container2.innerHTML = '';
        const backBtn2 = document.createElement('button');
        backBtn2.className = 'text-[11px] text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-800';
        backBtn2.textContent = '목록으로';
        backBtn2.onclick = () => navigate('materials-board');
        container2.appendChild(backBtn2);
    });
};
window.requestDeposit = async function(materialId) {
    if (!state.user) return showToast('입문 후 구매 가능하오.', 'error');
    let name = (document.getElementById('dep-name')?.value || '').trim();
    name = name.replace(/[^가-힣a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    const amount = parseInt(document.getElementById('dep-amount')?.value || '0', 10);
    const memo = (document.getElementById('dep-memo')?.value || '').trim();
    if (!name || isNaN(amount) || amount <= 0) return showToast('입금자명/입금액을 확인하시오.', 'error');
    try {
        const { data: meta } = await client.from('materials').select('id,price').eq('id', materialId).single();
        const price = Number(meta?.price || 0);
        const diff = Math.abs(price - amount);
        if (price > 0 && diff > 1000) {
            return showToast('입금액이 가격과 차이가 큼. 금액을 확인하시오.', 'error');
        }
        const { data: exist } = await client.from('deposit_requests')
            .select('id,status').eq('user_id', state.user.id).eq('material_id', materialId)
            .in('status', ['requested','pending']).limit(1);
        if (exist && exist.length) {
            return showToast('이미 입금 확인 요청이 접수되어 있소.', 'info');
        }
    } catch {}
    try {
        await client.from('deposit_requests').insert({
            user_id: state.user.id,
            material_id: materialId,
            depositor_name: name,
            amount,
            memo: memo || null,
            status: 'requested'
        });
        showToast('입금 확인을 요청했소. 관아에서 확인 후 열람 가능하오.', 'success');
        openMaterialDetail(materialId);
    } catch {
        showToast('요청에 차질이 있소.', 'error');
    }
};
window.saveMaterial = async function() {
    if (!state.user) return showToast('입문 후 등록 가능하오.', 'error');
    const title = (document.getElementById('mat-title').value || '').trim();
    const preview = (document.getElementById('mat-preview').value || '').trim();
    const price = parseInt(document.getElementById('mat-price').value || '0', 10);
    const content = (document.getElementById('mat-content').value || '').trim();
    if (!title || !content || isNaN(price)) return showToast('제목/가격/내용을 확인하시오.', 'error');
    try {
        const { data: m } = await client.from('materials').insert({ user_id: state.user.id, title, preview, price, is_active: true }).select('id').single();
        if (!m || !m.id) throw new Error('no id');
        await client.from('material_contents').insert({ material_id: m.id, content });
        showToast('등록 완료했소.', 'success');
        navigate('materials-board');
        loadMaterialsBoard();
    } catch {
        showToast('등록에 차질이 있소.', 'error');
    }
}
async function loadMyJournal() {
    if (!state.user) return;
    const box = document.getElementById('my-journal-list');
    box.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">불러오는 중...</div>';
    const { data, error } = await client.from('journal_entries')
        .select('*')
        .eq('user_id', state.user.id)
        .order('entry_date', { ascending: false })
        .limit(100);
    if (error) { box.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">기록이 없소.</div>'; return; }
    box.innerHTML = '';
    (data || []).forEach(j => {
        const el = document.createElement('div');
        const signClass = j.profit_amount >= 0 ? 'text-red-400' : 'text-blue-400';
        const pct = (Math.round(j.profit_percent * 100) / 100).toFixed(2);
        el.className = 'card-elegant p-3';
        el.innerHTML = `<div class="flex justify-between items-center">
            <div class="text-sm text-white">₩${Number(j.base_capital).toLocaleString('ko-KR')}</div>
            <div class="text-xs text-gray-400">${j.entry_date}</div>
        </div>
        <div class="flex justify-between items-center mt-1">
            <div class="${signClass} font-bold">₩${Number(j.profit_amount).toLocaleString('ko-KR')}</div>
            <div class="${signClass} text-sm">${pct}%</div>
        </div>
        ${j.strategy ? `<div class="text-[11px] text-gray-400 mt-1">전략: ${j.strategy}</div>` : ''}
        ${j.tags ? `<div class="text-[11px] text-gray-400">태그: ${j.tags}</div>` : ''}
        ${j.note ? `<div class="text-xs text-gray-300 mt-2">${linkifyHtml(j.note)}</div>` : ''}
        <div class="flex justify-end items-center gap-2 mt-2">
            <span class="text-[11px] ${j.is_public ? 'text-yellow-400' : 'text-gray-500'}">${j.is_public ? '공개' : '비공개'}</span>
            <button class="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded hover:bg-gray-700" onclick="toggleJournalPublic('${j.id}', ${j.is_public ? 'false' : 'true'})">${j.is_public ? '비공개' : '공개'}</button>
            <button class="text-xs bg-red-800 text-white px-2 py-1 rounded hover:bg-red-700" onclick="deleteJournal('${j.id}')">파기</button>
        </div>`;
        box.appendChild(el);
    });
    renderMyJournalChart(data || []);
    renderMonthlySummary(data || []);
    renderCumulativeChart(data || []);
    state.myJournalEntries = data || [];
    loadJournalGoals();
}

window.saveJournalEntry = async function() {
    if (!state.user) return showToast('입문 후 이용 가능하오.', 'error');

    const stockName = document.getElementById('journal-stock-name').value.trim();
    const buyPrice = parseFloat(document.getElementById('journal-buy-price').value) || 0;
    const sellPrice = parseFloat(document.getElementById('journal-sell-price').value) || 0;
    const quantity = parseInt(document.getElementById('journal-quantity').value) || 1;
    const date = document.getElementById('journal-date').value;
    const strategy = document.getElementById('journal-strategy').value.trim();
    const isPublic = document.getElementById('journal-is-public').checked;

    if (!stockName) return showToast('종목명을 입력하시오.', 'error');
    if (!date) return showToast('날짜를 입력하시오.', 'error');

    let profitAmount = 0;
    let profitPercent = 0;
    if (sellPrice > 0) {
        profitAmount = (sellPrice - buyPrice) * quantity;
        profitPercent = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0;
    }

    const payload = {
        user_id: state.user.id,
        stock_name: stockName,
        buy_price: buyPrice,
        sell_price: sellPrice,
        quantity: quantity,
        entry_date: date,
        strategy: strategy,
        is_public: isPublic,
        profit_amount: profitAmount,
        profit_percent: profitPercent,
        base_capital: buyPrice * quantity
    };

    const { error } = await client.from('journal_entries').insert(payload);
    if (error) {
        console.error('Journal Save Error:', error);
        showToast('일지 기록에 차질이 생겼소.', 'error');
    } else {
        showToast('일지가 기록되었소.', 'success');
        closeModal('newJournalModal');
        // Clear fields
        document.getElementById('journal-stock-name').value = '';
        document.getElementById('journal-buy-price').value = '';
        document.getElementById('journal-sell-price').value = '';
        document.getElementById('journal-quantity').value = '';
        document.getElementById('journal-strategy').value = '';
        
        loadMyJournal();
        if (isPublic) loadJournalFeed();
    }
};

window.toggleJournalPublic = async function(id, toPublic) {
    if (!state.user) return;
    const { error } = await client.from('journal_entries').update({ is_public: !!toPublic }).eq('id', id).eq('user_id', state.user.id);
    if (error) return showToast('변경 불발.', 'error');
    loadMyJournal();
    loadJournalFeed();
}

window.deleteJournal = async function(id) {
    if (!state.user) return;
    const { error } = await client.from('journal_entries').delete().eq('id', id).eq('user_id', state.user.id);
    if (error) return showToast('파기에 차질.', 'error');
    loadMyJournal();
    loadJournalFeed();
}

async function loadJournalFeed() {
    const box = document.getElementById('journal-feed');
    if (!box) return;
    box.innerHTML = '';
    try {
        const { data } = await client.from('journal_entries')
            .select('*, profiles:user_id (nickname, avatar_url)')
            .eq('is_public', true)
            .order('created_at', { ascending: false })
            .limit(5);
        (data || []).forEach(j => {
            const el = document.createElement('div');
            const signClass = j.profit_amount >= 0 ? 'text-red-400' : 'text-blue-400';
            const pct = (Math.round(j.profit_percent * 100) / 100).toFixed(2);
            const author = j.profiles?.nickname || '익명';
            const avatar = j.profiles?.avatar_url;
            el.className = 'py-2 border-b border-gray-800 last:border-b-0';
            el.innerHTML = `
                <div class="flex items-center justify-between mb-1">
                    <div class="flex items-center gap-1.5 min-w-0">
                        ${avatar ? `<img src="${avatar}" class="w-3.5 h-3.5 rounded-full">` : `<div class="w-3.5 h-3.5 rounded-full bg-gray-800 flex items-center justify-center text-[8px]">👤</div>`}
                        <span class="text-gray-400 truncate text-[11px]">${author}</span>
                    </div>
                    <span class="${signClass} font-bold text-[11px]">${j.profit_amount >= 0 ? '+' : ''}${pct}%</span>
                </div>
                <div class="text-[10px] text-gray-500 line-clamp-1">${j.note || j.strategy || '매매 복기...'}</div>
            `;
            box.appendChild(el);
        });
    } catch {
        box.innerHTML = '';
    }
}

async function loadJournalBoard() {
    const box = document.getElementById('journal-board-list');
    if (!box) return;
    box.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">불러오는 중...</div>';
    const kw = (document.getElementById('journal-filter-keyword')?.value || '').trim();
    const strat = (document.getElementById('journal-filter-strategy')?.value || '').trim();
    const posOnly = !!document.getElementById('journal-filter-positive')?.checked;
    const negOnly = !!document.getElementById('journal-filter-negative')?.checked;
    let q = client.from('journal_entries')
        .select('*, profiles:user_id (nickname, avatar_url)')
        .eq('is_public', true)
        .order('created_at', { ascending: false })
        .limit(100);
    if (kw) {
        q = q.or(`note.ilike.%${kw}%,tags.ilike.%${kw}%`);
    }
    if (strat) q = q.ilike('strategy', `%${strat}%`);
    if (posOnly && !negOnly) q = q.gte('profit_amount', 0);
    if (negOnly && !posOnly) q = q.lt('profit_amount', 0);
    const { data, error } = await q;
    if (error) { box.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">표시할 일지가 없소.</div>'; return; }
    box.innerHTML = '';
    (data || []).forEach(j => {
        const el = document.createElement('div');
        const signClass = j.profit_amount >= 0 ? 'text-red-400' : 'text-blue-400';
        const pct = (Math.round(j.profit_percent * 100) / 100).toFixed(2);
        const author = j.profiles?.nickname || '익명';
        const avatar = j.profiles?.avatar_url;
        el.className = 'bg-[#1C1C1E] p-3 rounded-xl border border-gray-800';
        el.innerHTML = `<div class="flex justify-between items-center">
            <div class="flex items-center gap-2 min-w-0">
                ${avatar ? `<img src="${avatar}" class="w-6 h-6 rounded-full flex-shrink-0">` : `<span class="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-[12px] flex-shrink-0">👤</span>`}
                <div class="text-xs text-gray-400 truncate max-w-[120px]">${author}</div>
            </div>
            <div class="text-[11px] text-gray-500">${j.entry_date}</div>
        </div>
        <div class="flex justify-between items-center mt-1">
            <div class="${signClass} font-bold">₩${Number(j.profit_amount).toLocaleString('ko-KR')}</div>
            <div class="${signClass} text-sm">${pct}%</div>
        </div>
        ${j.strategy ? `<div class="text-[11px] text-gray-400 mt-1">전략: ${j.strategy}</div>` : ''}
        ${j.tags ? `<div class="text-[11px] text-gray-400">태그: ${j.tags}</div>` : ''}
        ${j.note ? `<div class="text-xs text-gray-300 mt-2 break-words">${linkifyHtml(j.note)}</div>` : ''}`;
        box.appendChild(el);
    });
}

function drawSparkline(canvas, values) {
    if (!canvas) return;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const cssW = canvas.clientWidth || 300;
    const cssH = canvas.clientHeight || 80;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!values || !values.length) return;
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const span = max - min || 1;
    const zeroY = cssH - ((0 - min) / span) * cssH;
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, zeroY, cssW, 1);
    const stepX = cssW / Math.max(1, values.length - 1);
    ctx.lineWidth = 2;
    ctx.strokeStyle = (values[values.length - 1] >= 0) ? '#ef4444' : '#3b82f6';
    ctx.beginPath();
    values.forEach((v, i) => {
        const x = i * stepX;
        const y = cssH - ((v - min) / span) * cssH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
}

function drawMiniCandle(canvas, open, high, low, close) {
    if (!canvas) return;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const cssW = canvas.clientWidth || 120;
    const cssH = canvas.clientHeight || 48;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    let min = Math.min(open, high, low, close);
    let max = Math.max(open, high, low, close);
    if (max === min) {
        const pad = Math.max(0.5, Math.abs(max) * 0.002);
        max += pad;
        min -= pad;
    }
    const span = max - min || 1;
    const padY = 4;
    const y = (v)=> (cssH - padY) - ((v - min) / span) * (cssH - padY * 2);
    const color = close >= open ? '#ef4444' : '#3b82f6';
    const cx = Math.round(cssW / 2);
    const bodyW = Math.max(6, Math.round(cssW * 0.18));
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, y(high));
    ctx.lineTo(cx, y(low));
    ctx.stroke();
    const top = Math.min(y(open), y(close));
    const bot = Math.max(y(open), y(close));
    const h = Math.max(4, bot - top);
    ctx.fillStyle = color;
    ctx.fillRect(cx - Math.round(bodyW/2), top, bodyW, h);
    ctx.strokeRect(cx - Math.round(bodyW/2), top, bodyW, h);
}
function drawMiniCandleSeries(canvas, candles) {
    if (!canvas) return;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const cssW = canvas.clientWidth || 240;
    const cssH = canvas.clientHeight || 80;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const values = candles.flatMap(c => [c.h, c.l]);
    if (!values.length) return;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max === min) {
        const pad = Math.max(0.5, Math.abs(max) * 0.002);
        max += pad;
        min -= pad;
    }
    const span = max - min || 1;
    const padY = 4;
    const y = (v)=> (cssH - padY) - ((v - min) / span) * (cssH - padY * 2);
    const count = candles.length;
    const slot = cssW / count;
    const bodyW = Math.max(4, Math.min(10, Math.round(slot * 0.5)));
    candles.forEach((c, i) => {
        const cx = Math.round(i * slot + slot / 2);
        const color = c.c >= c.o ? '#ef4444' : '#3b82f6';
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(cx, y(c.h));
        ctx.lineTo(cx, y(c.l));
        ctx.stroke();
        const top = Math.min(y(c.o), y(c.c));
        const bot = Math.max(y(c.o), y(c.c));
        const h = Math.max(3, bot - top);
        ctx.fillStyle = color;
        ctx.fillRect(cx - Math.round(bodyW/2), top, bodyW, h);
        ctx.strokeRect(cx - Math.round(bodyW/2), top, bodyW, h);
    });
}
function renderMyJournalChart(entries) {
    const canvas = document.getElementById('my-journal-chart');
    if (!canvas) return;
    const sorted = entries.slice().sort((a, b) => new Date(a.entry_date) - new Date(b.entry_date));
    const recent = sorted.slice(-30);
    const values = recent.map(e => Number(e.profit_percent) || 0);
    drawSparkline(canvas, values);
    const totalProfit = entries.reduce((s, e) => s + (Number(e.profit_amount) || 0), 0);
    const avgPct = entries.length ? entries.reduce((s, e) => s + (Number(e.profit_percent) || 0), 0) / entries.length : 0;
    const statsEl = document.getElementById('my-journal-stats');
    if (statsEl) {
        const signClass = totalProfit >= 0 ? 'text-red-400' : 'text-blue-400';
        statsEl.innerHTML = `<span class="${signClass}">₩${Math.round(totalProfit).toLocaleString('ko-KR')}</span> • <span>${(Math.round(avgPct*100)/100).toFixed(2)}%</span>`;
    }
}

function renderMonthlySummary(entries) {
    const box = document.getElementById('my-journal-monthly');
    if (!box) return;
    const map = {};
    entries.forEach(e => {
        const d = new Date(e.entry_date);
        if (isNaN(d.getTime())) return;
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        map[key] = map[key] || { profit: 0, count: 0, pctSum: 0 };
        map[key].profit += Number(e.profit_amount) || 0;
        map[key].pctSum += Number(e.profit_percent) || 0;
        map[key].count += 1;
    });
    const rows = Object.keys(map).sort().slice(-6).map(k => {
        const v = map[k];
        const avgPct = v.count ? (v.pctSum / v.count) : 0;
        const signClass = v.profit >= 0 ? 'text-red-400' : 'text-blue-400';
        return { key: k, profit: v.profit, avgPct, signClass };
    });
    box.innerHTML = '';
    rows.forEach(r => {
        const el = document.createElement('div');
        el.className = 'card-elegant p-3';
        el.innerHTML = `<div class="flex justify-between items-center">
            <div class="text-xs text-gray-400">${r.key}</div>
            <div class="${r.signClass} text-sm font-bold">₩${Math.round(r.profit).toLocaleString('ko-KR')}</div>
        </div>
        <div class="text-[11px] text-gray-500">평균 ${(Math.round(r.avgPct*100)/100).toFixed(2)}%</div>`;
        box.appendChild(el);
    });
    const barsCanvas = document.getElementById('my-journal-monthly-bars');
    const profits = rows.map(r => r.profit);
    drawBars(barsCanvas, profits);
}

function renderCumulativeChart(entries) {
    const canvas = document.getElementById('my-journal-cum-chart');
    if (!canvas) return;
    const sorted = entries.slice().sort((a, b) => new Date(a.entry_date) - new Date(b.entry_date));
    const values = [];
    let run = 0;
    sorted.forEach(e => {
        run += Number(e.profit_amount) || 0;
        values.push(run);
    });
    drawSparkline(canvas, values);
}

function drawBars(canvas, values) {
    if (!canvas) return;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const cssW = canvas.clientWidth || 300;
    const cssH = canvas.clientHeight || 80;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!values || !values.length) return;
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const span = max - min || 1;
    const barW = Math.max(6, Math.floor(cssW / (values.length * 2)));
    const gap = barW;
    let x = 0;
    values.forEach(v => {
        const h = ((Math.abs(v)) / span) * cssH;
        const y = v >= 0 ? (cssH - h) : (cssH - ((0 - min) / span) * cssH);
        ctx.fillStyle = v >= 0 ? '#ef4444' : '#3b82f6';
        ctx.fillRect(x, y, barW, h);
        x += barW + gap;
    });
}

async function saveJournalGoal() {
    if (!state.user) return showToast('입문 후 기록 가능하오.', 'error');
    const ym = (document.getElementById('journal-goal-month').value || '').trim();
    const target = parseFloat(document.getElementById('journal-goal-target').value || '0');
    if (!ym || !target) return showToast('월과 목표를 채우시오.', 'error');
    const payload = { user_id: state.user.id, ym, target_profit: target };
    const { error } = await client.from('journal_monthly_goals').upsert(payload);
    if (error) return showToast('목표 기록 실패.', 'error');
    loadJournalGoals();
}

async function loadJournalGoals() {
    if (!state.user || !state.myJournalEntries) return;
    const keys = Array.from(new Set((state.myJournalEntries || []).map(e => {
        const d = new Date(e.entry_date);
        if (isNaN(d.getTime())) return null;
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    }).filter(Boolean))).slice(-6);
    const { data } = await client.from('journal_monthly_goals').select('*').eq('user_id', state.user.id).in('ym', keys);
    const goals = {};
    (data || []).forEach(g => { goals[g.ym] = Number(g.target_profit) || 0; });
    renderMonthlySummaryWithGoals(state.myJournalEntries, goals);
}

function renderMonthlySummaryWithGoals(entries, goals) {
    const box = document.getElementById('my-journal-monthly');
    if (!box) return;
    const map = {};
    entries.forEach(e => {
        const d = new Date(e.entry_date);
        if (isNaN(d.getTime())) return;
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        map[key] = map[key] || { profit: 0, count: 0, pctSum: 0 };
        map[key].profit += Number(e.profit_amount) || 0;
        map[key].pctSum += Number(e.profit_percent) || 0;
        map[key].count += 1;
    });
    const rows = Object.keys(map).sort().slice(-6).map(k => {
        const v = map[k];
        const avgPct = v.count ? (v.pctSum / v.count) : 0;
        const signClass = v.profit >= 0 ? 'text-red-400' : 'text-blue-400';
        const goal = goals?.[k] || 0;
        const achieve = goal ? Math.round((v.profit / goal) * 100) : null;
        return { key: k, profit: v.profit, avgPct, signClass, goal, achieve };
    });
    box.innerHTML = '';
    rows.forEach(r => {
        const el = document.createElement('div');
        el.className = 'bg-[#141416] p-3 rounded-xl border border-gray-800';
        el.innerHTML = `<div class="flex justify-between items-center">
            <div class="text-xs text-gray-400">${r.key}</div>
            <div class="${r.signClass} text-sm font-bold">₩${Math.round(r.profit).toLocaleString('ko-KR')}</div>
        </div>
        <div class="text-[11px] text-gray-500">평균 ${(Math.round(r.avgPct*100)/100).toFixed(2)}%${r.goal ? ` • 목표 ₩${Math.round(r.goal).toLocaleString('ko-KR')} (${r.achieve}% 달성)` : ''}</div>`;
        box.appendChild(el);
    });
    const barsCanvas = document.getElementById('my-journal-monthly-bars');
    const profits = rows.map(r => r.profit);
    drawBars(barsCanvas, profits);
}

document.addEventListener('DOMContentLoaded', () => {
    const k = document.getElementById('journal-filter-keyword');
    const s = document.getElementById('journal-filter-strategy');
    const p = document.getElementById('journal-filter-positive');
    const n = document.getElementById('journal-filter-negative');
    [k, s, p, n].forEach(el => {
        if (el) el.addEventListener('input', () => {
            if (document.getElementById('journal-board') && !document.getElementById('journal-board').classList.contains('hidden')) {
                loadJournalBoard();
            }
        });
        if (el) el.addEventListener('change', () => {
            if (document.getElementById('journal-board') && !document.getElementById('journal-board').classList.contains('hidden')) {
                loadJournalBoard();
            }
        });
    });
});

function initJournalTabIfNeeded() {
    const tab = document.getElementById('tab-my-journal');
    if (tab) loadMyJournal();
}
// ------------------------------------------------------------------
// 7. My Page (본거지) & Settings
// ------------------------------------------------------------------

async function renderMyPage() {
    if (!state.user) {
        showToast('입문이 필요하오.', 'error');
        // If not logged in, maybe redirect or show empty state? 
        // But UI handles basic empty state. Let's update UI to reflect "Not Logged In"
        document.getElementById('my-nickname').innerText = '입문 필요';
        document.getElementById('my-email').innerText = '강호에 입문하시오.';
        document.getElementById('my-level-badge').innerText = '미입문';
        return;
    }

    // 1. Profile Info
    const { data: profile } = await client.from('profiles').select('*').eq('id', state.user.id).single();
    if (profile) {
        state.profile = profile; // Sync state
        document.getElementById('my-nickname').innerText = profile.nickname;
        document.getElementById('edit-nickname').value = profile.nickname;
        document.getElementById('my-email').innerText = state.user.email;
        if (document.getElementById('badge-style-select')) {
            document.getElementById('badge-style-select').value = profile.badge_style || 'auto';
        }
        if (document.getElementById('badge-icon-select')) {
            document.getElementById('badge-icon-select').value = profile.badge_icon || '';
        }
        if (document.getElementById('theme-style-select')) {
            document.getElementById('theme-style-select').value = profile.theme_style || 'dark';
        }
        if (profile.avatar_url) {
            const img = document.getElementById('my-avatar');
            const icon = document.getElementById('my-profile-icon');
            img.src = profile.avatar_url;
            img.classList.remove('hidden');
            icon.classList.add('hidden');
        }
        if (profile.banner_url) {
            const card = document.getElementById('my-profile-card');
            card.style.backgroundImage = `url('${profile.banner_url}')`;
            card.style.backgroundSize = 'cover';
            card.style.backgroundPosition = 'center';
        }
        document.getElementById('noti-comment').checked = profile.receive_comment_noti ?? true;
        document.getElementById('noti-like').checked = profile.receive_like_noti ?? true;
        document.getElementById('noti-message').checked = profile.receive_message_noti ?? true;
        const previewChk = document.getElementById('preview-enabled');
        if (previewChk) previewChk.checked = state.previewEnabled;
        const recoChk = document.getElementById('reco-logging-enabled');
        if (recoChk) recoChk.checked = state.dataCollectionEnabled;
        const proxyInput = document.getElementById('proxy-url-input');
        if (proxyInput) {
            try {
                proxyInput.value = localStorage.getItem('link_preview_proxy') || '';
            } catch { proxyInput.value = ''; }
        }
        
        const level = calculateLevel(profile.post_count, profile.comment_count);
        const badge = document.getElementById('my-level-badge');
        badge.innerText = level.name;
        // 스타일 결정 (자동 또는 강제 스타일)
        const style = profile.badge_style || 'auto';
        let colorClass = level.color; // text-yellow-400 | text-cyan-400
        if (style === 'gold') colorClass = 'text-yellow-400';
        if (style === 'cyan') colorClass = 'text-cyan-400';
        if (style === 'gray') colorClass = 'text-gray-400';
        badge.className = `absolute -bottom-1 -right-1 text-black text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#1C1C1E]`;
        if (colorClass.includes('yellow')) badge.classList.add('bg-yellow-500');
        else if (colorClass.includes('cyan')) badge.classList.add('bg-cyan-500');
        else badge.classList.add('bg-gray-500');
        const badgeIconEl = document.getElementById('my-badge-icon');
        if (badgeIconEl) {
            const iconKey = profile.badge_icon || '';
            let iconChar = '';
            if (iconKey === 'dragon') iconChar = '🐉';
            if (iconKey === 'star') iconChar = '⭐';
            if (iconKey === 'sword') iconChar = '⚔️';
            if (iconChar) {
                badgeIconEl.textContent = iconChar;
                badgeIconEl.classList.remove('hidden');
            } else {
                badgeIconEl.classList.add('hidden');
            }
        }

        // Stats
        document.getElementById('stat-posts').innerText = profile.post_count || 0;
        document.getElementById('stat-comments').innerText = profile.comment_count || 0;
        
        // Calculate received likes (Total likes on my posts)
        // This requires a sum query on posts.
        const { data: posts } = await client.from('posts').select('like_count').eq('user_id', state.user.id);
        const totalLikes = posts ? posts.reduce((sum, p) => sum + (p.like_count || 0), 0) : 0;
        document.getElementById('stat-likes').innerText = totalLikes;
        try {
            const { data: guilds } = await client.from('guild_memberships').select('stock_id').eq('user_id', state.user.id).limit(10);
            const box = document.getElementById('my-guild-badges');
            if (box) {
                box.innerHTML = '';
                (guilds || []).forEach(g => {
                    const el = document.createElement('span');
                    el.className = 'px-2 py-1 rounded-full text-[11px] bg-gray-800 border border-gray-700 text-yellow-400';
                    el.textContent = g.stock_id;
                    box.appendChild(el);
                });
            }
        } catch {}
    }

    // 2. Default Tab: My Posts
    switchMyPageTab('posts');
}

window.switchMyPageTab = function(tab) {
    // UI Toggling
    ['posts', 'activity', 'bookmarks', 'journal', 'settings'].forEach(t => {
        const btn = document.getElementById(`tab-my-${t}`);
        const area = document.getElementById(`my-${t}-area`);
        
        if (!btn) return;
        
        if (t === tab) {
            btn.className = 'pb-3 text-sm font-bold text-white border-b-2 border-white whitespace-nowrap transition-colors';
            if(area) area.classList.remove('hidden');
        } else {
            btn.className = 'pb-3 text-sm font-medium text-gray-500 border-b-2 border-transparent hover:text-gray-300 whitespace-nowrap transition-colors';
            if(area) area.classList.add('hidden');
        }
    });

    if (tab === 'posts') loadMyPosts();
    if (tab === 'bookmarks') loadBookmarkedPosts();
    if (tab === 'activity') loadMyActivity('all');
    if (tab === 'journal') loadMyJournal();
    if (tab === 'settings') loadMyDeposits();
}

async function loadMyJournal() {
    const area = document.getElementById('my-journal-area');
    if (!area) return;
    
    area.innerHTML = '<div class="text-center text-gray-500 py-10">일지를 불러오는 중...</div>';
    
    const { data: entries, error } = await client.from('journal_entries')
        .select('*')
        .eq('user_id', state.user.id)
        .order('entry_date', { ascending: false });

    if (error) {
        area.innerHTML = '<div class="text-center text-gray-500 py-10">일지를 불러오는데 실패했소.</div>';
        console.error('Journal load error:', error);
        return;
    }

    if (!entries || entries.length === 0) {
        area.innerHTML = '<div class="text-center text-gray-500 py-10">작성된 일지가 없소.</div>';
        return;
    }

    area.innerHTML = '<div class="space-y-3">' + entries.map(e => `
        <div class="p-4 rounded-xl bg-gray-900 border border-gray-800">
            <div class="flex justify-between items-start mb-2">
                <div class="text-sm text-gray-400">${e.entry_date}</div>
                <div class="flex gap-2">
                    <span class="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300">${e.is_public ? '공개' : '비공개'}</span>
                </div>
            </div>
            <div class="flex gap-4 text-sm mb-3">
                <div>
                    <span class="text-gray-500 text-xs block">수익금</span>
                    <span class="${e.profit_amount >= 0 ? 'text-red-500' : 'text-blue-500'} font-bold">
                        ${Number(e.profit_amount).toLocaleString()}원
                    </span>
                </div>
                <div>
                    <span class="text-gray-500 text-xs block">수익률</span>
                    <span class="${e.profit_percent >= 0 ? 'text-red-500' : 'text-blue-500'} font-bold">
                        ${e.profit_percent}%
                    </span>
                </div>
            </div>
            ${e.note ? `<div class="text-sm text-gray-300 bg-black/30 p-3 rounded-lg">${e.note}</div>` : ''}
        </div>
    `).join('') + '</div>';
}

async function loadMyPosts() {
    const container = document.getElementById('my-posts-area');
    container.innerHTML = '<div class="text-center text-gray-500 py-10">비급을 찾는 중...</div>';
    
    const { data: posts, error } = await client.from('posts')
        .select(`*, profiles:user_id (nickname, post_count, comment_count)`)
        .eq('user_id', state.user.id)
        .order('created_at', { ascending: false });

    const postRows = Array.isArray(posts) ? posts : [];
    if (error || postRows.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 py-10">집필한 비급이 없소.</div>';
        return;
    }

    container.innerHTML = '';
    postRows.forEach(post => {
        const el = createPostElement(post);
        container.appendChild(el);
    });
}

async function loadBookmarkedPosts() {
    const container = document.getElementById('my-bookmarks-area');
    container.innerHTML = '<div class="text-center text-gray-500 py-10">비급을 찾는 중...</div>';
    
    // Join with post_likes to find liked posts
    // Supabase join syntax: select posts!inner(...) where post_likes.user_id = me
    // But easier: 1. Get liked post IDs. 2. Fetch posts.
    
    const { data: likes } = await client.from('post_likes').select('post_id').eq('user_id', state.user.id);
    const likeRows = Array.isArray(likes) ? likes : [];
    if (likeRows.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 py-10">마음에 둔 비급이 없소.</div>';
        return;
    }

    const postIds = likeRows.map(l => l.post_id);
    const { data: posts, error } = await client.from('posts')
        .select(`*, profiles:user_id (nickname, post_count, comment_count)`)
        .in('id', postIds)
        .order('created_at', { ascending: false });

    const postRows = Array.isArray(posts) ? posts : [];
    if (error || postRows.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 py-10">마음에 둔 비급이 없소.</div>';
        return;
    }

    container.innerHTML = '';
    postRows.forEach(post => {
        const el = createPostElement(post);
        const btn = document.createElement('button');
        btn.className = 'mt-2 text-xs bg-gray-800 text-gray-300 px-3 py-1.5 rounded-full hover:bg-gray-700';
        btn.innerText = '관심 철회';
        btn.onclick = () => unlikePostFromBookmarks(post.id);
        el.appendChild(btn);
        container.appendChild(el);
    });
}

let currentNotificationsFilter = 'all';
window.switchNotificationsFilter = function(type) {
    currentNotificationsFilter = type;
    ['all','comment','like','message','purchase'].forEach(t => {
        const btn = document.getElementById(`noti-filter-${t}`);
        if (btn) {
            if (t === type) {
                btn.classList.add('border-yellow-600','text-yellow-400');
            } else {
                btn.classList.remove('border-yellow-600','text-yellow-400');
            }
        }
    });
    loadNotifications();
}
async function loadMyNotifications() {
    const list = document.getElementById('my-notifications-list');
    list.innerHTML = '<div class="text-center text-gray-500 py-10">전갈을 찾는 중...</div>';
    let query = client.from('notifications')
        .select('*')
        .eq('user_id', state.user.id)
        .order('created_at', { ascending: false })
        .limit(50);
    if (currentNotificationsFilter !== 'all') {
        query = query.eq('type', currentNotificationsFilter);
    }
    const { data, error } = await query;
    if (error) {
        list.innerHTML = '<div class="text-center text-gray-500 py-10">전갈을 불러올 수 없소.</div>';
        return;
    }
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-500 py-10">전갈이 없소.</div>';
        return;
    }
    list.innerHTML = '';
    rows.forEach(noti => {
        const el = document.createElement('div');
        const t = noti.type || 'other';
        const icon = t === 'comment' ? '💬' : t === 'like' ? '❤️' : t === 'message' ? '✉️' : t === 'purchase' ? '💳' : '🔔';
        const cls = noti.is_read ? 'border-gray-600 opacity-60' : (t === 'comment' ? 'border-blue-500' : t === 'like' ? 'border-red-500' : t === 'message' ? 'border-green-500' : 'border-yellow-500');
        el.className = `bg-gray-800/50 p-3 rounded-lg border-l-4 ${cls}`;
        const when = new Date(noti.created_at).toLocaleString();
        const jump = noti.link ? `<button onclick="handleNotificationClick('${noti.link}', '${noti.id}')" class="text-[10px] bg-gray-700 px-2 py-1 rounded hover:bg-gray-600 mr-2">이동</button>` : '';
        const del = `<button onclick="deleteNotification('${noti.id}')" class="text-[10px] text-red-500">파기</button>`;
        el.innerHTML = `<p class="text-xs text-gray-300 mb-1"><span class="mr-2">${icon}</span>${linkifyHtml(noti.content)}</p><div class="flex justify-between items-center"><span class="text-[10px] text-gray-500">${when}</span><div class="flex items-center">${jump}${del}</div></div>`;
        list.appendChild(el);
    });
}
window.deleteNotification = async function(id) {
    if (!state.user || !id) return;
    await client.from('notifications').delete().eq('id', id).eq('user_id', state.user.id);
    loadMyNotifications();
    checkUnreadNotifications();
}
window.updateNickname = async function() {
    const newNickname = document.getElementById('edit-nickname').value.trim();
    if (!newNickname) return showToast('호(닉네임)를 입력하시오.', 'error');
    if (newNickname.length < 2) return showToast('호는 2자 이상이어야 하오.', 'error');
    
    // Check duplication (optional, but good)
    // For now, just try update
    const { error } = await client.from('profiles').update({ nickname: newNickname }).eq('id', state.user.id);
    
    if (error) {
        showToast('개명 불가. 이미 사용 중인 호일 수 있소.', 'error');
    } else {
        showToast('호가 변경되었소.', 'success');
        document.getElementById('my-nickname').innerText = newNickname;
        state.profile.nickname = newNickname; // Local update
    }
}

window.updateBadgeStyle = async function() {
    if (!state.user) return showToast('입문이 필요하오.', 'error');
    const style = document.getElementById('badge-style-select').value;
    const { error } = await client.from('profiles').update({ badge_style: style }).eq('id', state.user.id);
    if (error) {
        showToast('문양 양식 기록에 차질이 생겼소', 'error');
    } else {
        showToast('문양 양식이 기록되었소.', 'success');
        state.profile.badge_style = style;
        renderMyPage();
    }
}
window.updateBadgeIcon = async function() {
    if (!state.user) return showToast('입문이 필요하오.', 'error');
    const icon = document.getElementById('badge-icon-select').value;
    const { error } = await client.from('profiles').update({ badge_icon: icon }).eq('id', state.user.id);
    if (error) {
        showToast('문양 형태 기록에 차질이 생겼소', 'error');
    } else {
        showToast('문양 형태가 기록되었소.', 'success');
        state.profile.badge_icon = icon;
        renderMyPage();
    }
}
window.updateThemeStyle = async function() {
    if (!state.user) return showToast('입문이 필요하오.', 'error');
    const theme = document.getElementById('theme-style-select').value;
    const { error } = await client.from('profiles').update({ theme_style: theme }).eq('id', state.user.id);
    if (error) {
        showToast('배경 풍경 기록에 차질이 생겼소', 'error');
    } else {
        showToast('배경 풍경이 기록되었소.', 'success');
        if (state.profile) state.profile.theme_style = theme;
        document.documentElement.setAttribute('data-theme', theme);
    }
}
window.updatePassword = async function() {
    const newPw = document.getElementById('edit-pw').value;
    if (!newPw || newPw.length < 6) return showToast('암호는 6자 이상이어야 하오.', 'error');
    
    const { error } = await client.auth.updateUser({ password: newPw });
    
    if (error) {
        showToast('암호 변경에 차질이 생겼소: ' + error.message, 'error');
    } else {
        showToast('비급 봉인(암호)이 재설정되었소.', 'success');
        document.getElementById('edit-pw').value = '';
    }
}

window.updateAvatar = async function() {
    if (!state.user) return showToast('입문이 필요하오.', 'error');
    const input = document.getElementById('avatar-input');
    const file = input.files[0];
    if (!file) return showToast('이미지를 선택하시오.', 'error');
    const chk = validateImageFile(file, 5);
    if (!chk.ok) {
        showToast(chk.message, 'error');
        input.value = '';
        return;
    }
    try {
        const oldUrl = state.profile?.avatar_url;
        const url = await uploadImage(file, 'avatars');
        const { error } = await client.from('profiles').update({ avatar_url: url }).eq('id', state.user.id);
        if (error) {
            showToast('용모(프로필) 변경에 차질이 생겼소', 'error');
        } else {
            showToast('용모가 변경되었소.', 'success');
            const img = document.getElementById('my-avatar');
            const icon = document.getElementById('my-profile-icon');
            img.src = url;
            img.classList.remove('hidden');
            icon.classList.add('hidden');
            if (oldUrl) deleteStorageFileByUrl(oldUrl);
            if (state.profile) state.profile.avatar_url = url;
        }
    } finally {
        input.value = '';
    }
}

window.updateBanner = async function() {
    if (!state.user) return showToast('입문이 필요하오.', 'error');
    const input = document.getElementById('banner-input');
    const file = input.files[0];
    if (!file) return showToast('이미지를 선택하시오.', 'error');
    const chk = validateImageFile(file, 5);
    if (!chk.ok) {
        showToast(chk.message, 'error');
        input.value = '';
        return;
    }
    try {
        const oldUrl = state.profile?.banner_url;
        const url = await uploadImage(file, 'banners');
        const { error } = await client.from('profiles').update({ banner_url: url }).eq('id', state.user.id);
        if (error) {
            showToast('문파 깃발(배너) 변경에 차질이 생겼소', 'error');
        } else {
            showToast('문파 깃발이 변경되었소.', 'success');
            const card = document.getElementById('my-profile-card');
            card.style.backgroundImage = `url('${url}')`;
            card.style.backgroundSize = 'cover';
            card.style.backgroundPosition = 'center';
            if (oldUrl) deleteStorageFileByUrl(oldUrl);
            if (state.profile) state.profile.banner_url = url;
        }
    } finally {
        input.value = '';
    }
}

window.removeAvatar = async function() {
    if (!state.user) return showToast('입문이 필요하오.', 'error');
    const oldUrl = state.profile?.avatar_url;
    if (!oldUrl) return showToast('이미 등록된 용모가 없소.', 'error');
    const { error } = await client.from('profiles').update({ avatar_url: null }).eq('id', state.user.id);
    if (error) return showToast('용모 제거에 차질이 생겼소.', 'error');
    deleteStorageFileByUrl(oldUrl);
    const img = document.getElementById('my-avatar');
    const icon = document.getElementById('my-profile-icon');
    if (img) {
        img.src = '';
        img.classList.add('hidden');
    }
    if (icon) icon.classList.remove('hidden');
    if (state.profile) state.profile.avatar_url = null;
    showToast('용모를 제거했소.', 'success');
}

window.removeBanner = async function() {
    if (!state.user) return showToast('입문이 필요하오.', 'error');
    const oldUrl = state.profile?.banner_url;
    if (!oldUrl) return showToast('등록된 깃발이 없소.', 'error');
    const { error } = await client.from('profiles').update({ banner_url: null }).eq('id', state.user.id);
    if (error) return showToast('문파 깃발 제거에 차질이 생겼소.', 'error');
    deleteStorageFileByUrl(oldUrl);
    const card = document.getElementById('my-profile-card');
    if (card) {
        card.style.backgroundImage = '';
        card.style.backgroundSize = '';
        card.style.backgroundPosition = '';
    }
    if (state.profile) state.profile.banner_url = null;
    showToast('문파 깃발을 제거했소.', 'success');
}

window.updateNotificationSettings = async function() {
    if (!state.user) return showToast('입문이 필요하오.', 'error');
    const commentOn = document.getElementById('noti-comment').checked;
    const likeOn = document.getElementById('noti-like').checked;
    const messageOn = document.getElementById('noti-message').checked;
    const { error } = await client.from('profiles').update({
        receive_comment_noti: commentOn,
        receive_like_noti: likeOn,
        receive_message_noti: messageOn
    }).eq('id', state.user.id);
    if (error) {
        showToast('전갈 설정 기록에 차질이 생겼소', 'error');
    } else {
        showToast('전갈 설정이 기록되었소.', 'success');
        state.profile.receive_comment_noti = commentOn;
        state.profile.receive_like_noti = likeOn;
        state.profile.receive_message_noti = messageOn;
    }
}
async function loadMyActivity() {
    const list = document.getElementById('activity-list');
    list.innerHTML = '<div class="text-center text-gray-500 py-6">행적을 찾는 중...</div>';
    const { data: myComments } = await client.from('comments')
        .select('content, created_at, post_id, posts:post_id (id, title, type)')
        .eq('user_id', state.user.id)
        .order('created_at', { ascending: false })
        .limit(20);
    const { data: myLikes } = await client.from('post_likes')
        .select('created_at, post_id, posts:post_id (id, title, type)')
        .eq('user_id', state.user.id)
        .order('created_at', { ascending: false })
        .limit(20);
    list.innerHTML = '';
    const items = [];
    (myComments || []).forEach(c => items.push({ t: 'comment', d: c.created_at, text: c.content, post: c.posts }));
    (myLikes || []).forEach(l => items.push({ t: 'like', d: l.created_at, text: '', post: l.posts }));
    items.sort((a, b) => new Date(b.d) - new Date(a.d));
    if (items.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-500 py-10">최근 행적이 없소.</div>';
        return;
    }
    items.forEach(i => {
        const el = document.createElement('div');
        el.className = 'p-3 rounded-xl bg-[#1C1C1E] border border-gray-800 cursor-pointer';
        const when = new Date(i.d).toLocaleString();
        const label = i.t === 'comment' ? '전서' : '명성';
        const postTitle = i.post ? i.post.title : '';
        el.innerHTML = `<div class="flex justify-between items-center mb-1"><span class="text-xs text-gray-400">${label}</span><span class="text-[10px] text-gray-500">${when}</span></div><div class="text-sm text-white">${postTitle}</div>${i.t === 'comment' ? `<div class="text-xs text-gray-400 mt-1">${linkifyHtml(i.text)}</div>` : ''}`;
        el.onclick = async () => {
            if (!i.post || !i.post.id) return;
            const { data } = await client.from('posts').select(`*, profiles:user_id (nickname)`).eq('id', i.post.id).single();
            if (data) openPostDetail(data);
        };
        list.appendChild(el);
    });
}

window.switchActivityFilter = function(type) {
    ['all','comment','like'].forEach(t => {
        const btn = document.getElementById(`act-filter-${t}`);
        if (btn) {
            if (t === type) {
                btn.classList.add('border-yellow-600','text-yellow-400');
            } else {
                btn.classList.remove('border-yellow-600','text-yellow-400');
            }
        }
    });
    loadMyActivity(type);
}

async function loadMyActivity(type) {
    const list = document.getElementById('activity-list');
    list.innerHTML = '';
    const days = parseInt(state.activityFilter.days || 30, 10);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const cutoffISO = cutoff.toISOString();
    const { data: myComments } = await client.from('comments')
        .select('id, content, created_at, post_id, posts:post_id (id, title, type)')
        .eq('user_id', state.user.id)
        .gte('created_at', cutoffISO)
        .order('created_at', { ascending: false })
        .limit(20);
    const { data: myLikes } = await client.from('post_likes')
        .select('created_at, post_id, posts:post_id (id, title, type)')
        .eq('user_id', state.user.id)
        .gte('created_at', cutoffISO)
        .order('created_at', { ascending: false })
        .limit(20);
    const items = [];
    if (type === 'all' || type === 'comment') (myComments || []).forEach(c => items.push({ t: 'comment', d: c.created_at, text: c.content, post: c.posts, cid: c.id }));
    if (type === 'all' || type === 'like') (myLikes || []).forEach(l => items.push({ t: 'like', d: l.created_at, text: '', post: l.posts }));
    items.sort((a, b) => new Date(b.d) - new Date(a.d));
    const keyword = (state.activityFilter.keyword || '').toLowerCase();
    const filtered = items.filter(i => {
        const dateOk = new Date(i.d) >= cutoff;
        if (!dateOk) return false;
        if (!keyword) return true;
        const title = (i.post?.title || '').toLowerCase();
        const text = (i.text || '').toLowerCase();
        return title.includes(keyword) || text.includes(keyword);
    });
    if (filtered.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-500 py-10">최근 행적이 없소.</div>';
        return;
    }
    filtered.forEach(i => {
        const el = document.createElement('div');
        el.className = 'p-3 rounded-xl bg-[#1C1C1E] border border-gray-800 cursor-pointer';
        const when = new Date(i.d).toLocaleString();
        const label = i.t === 'comment' ? '전서' : '명성';
        const postTitle = i.post ? i.post.title : '';
        el.innerHTML = `<div class="flex justify-between items-center mb-1"><span class="text-xs text-gray-400">${label}</span><span class="text-[10px] text-gray-500">${when}</span></div><div class="text-sm text-white">${postTitle}</div>${i.t === 'comment' ? `<div class="text-xs text-gray-400 mt-1">${linkifyHtml(i.text)}</div>` : ''}`;
        el.onclick = async () => {
            if (!i.post || !i.post.id) return;
            const { data } = await client.from('posts').select(`*, profiles:user_id (nickname)`).eq('id', i.post.id).single();
            if (data) {
                openPostDetail(data);
                if (i.t === 'comment' && i.cid) {
                    scrollToComment(`comment-${i.cid}`);
                }
            }
        };
        list.appendChild(el);
    });
}
window.setActivityKeyword = function(v) {
    state.activityFilter.keyword = v || '';
    const active = document.querySelector('#my-activity-area .border-yellow-600')?.id || 'act-filter-all';
    const type = active.replace('act-filter-','');
    loadMyActivity(type);
}
window.setActivityDays = function(v) {
    state.activityFilter.days = parseInt(v || '30', 10);
    const active = document.querySelector('#my-activity-area .border-yellow-600')?.id || 'act-filter-all';
    const type = active.replace('act-filter-','');
    loadMyActivity(type);
}

async function unlikePostFromBookmarks(postId) {
    if (!state.user) return;
    await client.from('post_likes').delete().match({ user_id: state.user.id, post_id: postId });
    showToast('관심 비급에서 제거했습니다.', 'success');
    loadBookmarkedPosts();
}
async function fetchStockTags() {
    const { data } = await client.from('stock_tags').select('name').order('created_at', { ascending: true });
    if (data) {
        state.stockTags = data.map(t => t.name);
        renderStockTabs();
        renderStockOptions();
    }
}

function renderStockTabs() {
    const stockTabs = document.getElementById('stock-tabs');
    stockTabs.innerHTML = '';
    
    let tagsToRender = [...state.stockTags];
    if (state.currentStockName && !state.stockTags.includes(state.currentStockName)) {
        tagsToRender = [state.currentStockName, ...state.stockTags];
    }

    const makeBtn = (label, active, onClick) => {
        const btn = document.createElement('button');
        btn.className = `px-4 py-2 rounded-xl text-xs whitespace-nowrap transition-all border font-bold ${
            active ? 'bg-white text-black border-white shadow-lg transform scale-105' : 'bg-[#2C2C2E] text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-white hover:border-gray-600'
        }`;
        btn.innerText = label;
        btn.onclick = onClick;
        return btn;
    };
    const allActive = !state.currentStockName;
    stockTabs.appendChild(makeBtn('전체', allActive, () => setCurrentStock(null)));

    tagsToRender.forEach(tag => {
        const isActive = state.currentStockName === tag;
        stockTabs.appendChild(makeBtn(tag, isActive, () => setCurrentStock(tag)));
    });
}

function renderStockOptions() { 
    const dataList = document.getElementById('stock-options');
    if (!dataList) return;
    const opts = [];
    const seen = new Set();
    (state.stocksMaster.length ? state.stocksMaster : state.stockTags.map(n => ({ name: n }))).forEach(s => {
        const name = s.name;
        if (name && !seen.has(name)) { opts.push(`<option value="${name}">`); seen.add(name); }
        const code = s.code;
        if (code && !seen.has(code)) { opts.push(`<option value="${code}">`); seen.add(code); }
    });
    dataList.innerHTML = opts.join('');
}

function pushRecentStock(name) {
    if (!name) return;
    const arr = Array.isArray(state.recentStocks) ? state.recentStocks.slice() : [];
    const filtered = [name].concat(arr.filter(n => n !== name));
    state.recentStocks = filtered.slice(0, 8);
    try { localStorage.setItem('recent_stocks', JSON.stringify(state.recentStocks)); } catch {}
}

function setCurrentStock(name) {
    state.currentStockName = name || null;
    if (name) pushRecentStock(name);
    renderStockTabs();
    renderRecentStocks();
    updateCurrentStockHeader();
    renderPosts('posts-list-stock', 'stock', name || null);
    setupRealtimePostsForView();
}

function updateCurrentStockHeader() {
    const titleEl = document.getElementById('current-stock-name');
    const clr = document.getElementById('clear-stock-btn');
    if (titleEl) titleEl.innerText = state.currentStockName || '전체';
    if (clr) clr.classList.toggle('hidden', !state.currentStockName);
}

function renderRecentStocks() {
    const box = document.getElementById('recent-stocks');
    if (!box) return;
    const arr = Array.isArray(state.recentStocks) ? state.recentStocks : [];
    box.innerHTML = '';
    arr.forEach(name => {
        const b = document.createElement('button');
        b.className = 'px-2 py-1 rounded-full text-[11px] bg-[#1C1C1E] border border-gray-700 text-gray-300 hover:bg-gray-700';
        b.innerText = name;
        b.onclick = () => setCurrentStock(name);
        box.appendChild(b);
    });
}

function renderRecentStocksHome() {
    const box = document.getElementById('recent-stocks-home');
    if (!box) return;
    const arr = Array.isArray(state.recentStocks) ? state.recentStocks : [];
    if (arr.length === 0) { box.innerHTML = ''; return; }
    box.innerHTML = '';
    arr.forEach(name => {
        const b = document.createElement('button');
        b.className = 'px-2 py-1 rounded-full text-[11px] bg-[#1C1C1E] border border-gray-700 text-gray-300 hover:bg-gray-700';
        b.innerText = name;
        b.onclick = () => { navigate('stock-board'); setTimeout(() => setCurrentStock(name), 0); };
        box.appendChild(b);
    });
}

async function renderHotRooms(hours = 24) {
    const box = document.getElementById('hot-rooms');
    if (!box) return;
    const now = Date.now();
    if (state.hotRoomsCache && (now - state.hotRoomsCache.ts) < 300000 && state.hotRoomsCache.html) {
        box.innerHTML = state.hotRoomsCache.html;
        return;
    }
    box.innerHTML = '<div class="text-[11px] text-gray-500">핫한 토론방을 찾는 중...</div>';
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    try {
        let top = [];
        try {
            const { data: hot } = await client.rpc('get_hot_stock_rooms', { p_hours: hours, p_limit: 12 });
            if (Array.isArray(hot) && hot.length) {
                top = hot.map(r => ({ name: resolveStockName(r.stock_id) || r.stock_id, count: r.post_count || 0 }));
            }
        } catch {}
        if (!top.length) {
            const tags = [...(state.stockTags.length ? state.stockTags : state.stocksMaster.map(s => s.name))];
            if (tags.length === 0) { box.innerHTML = ''; return; }
            const counts = [];
            const sample = tags.slice(0, 60);
            for (const name of sample) {
                const { count } = await client.from('posts')
                    .select('*', { count: 'exact', head: true })
                    .eq('type', 'stock')
                    .eq('stock_id', name)
                    .gte('created_at', since);
                counts.push({ name, count: count || 0 });
            }
            counts.sort((a, b) => b.count - a.count);
            top = counts.slice(0, 12).filter(c => c.count > 0);
        }
        if (top.length === 0) {
            box.innerHTML = '<div class="text-[11px] text-gray-500">아직 뜨거운 토론방이 없소.</div>';
            return;
        }
        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-2 sm:grid-cols-3 gap-2';
        top.forEach(({ name, count }) => {
            const el = document.createElement('button');
            el.className = 'flex items-center justify-between px-3 py-2 rounded-xl bg-[#1C1C1E] border border-gray-800 hover:bg-gray-800 text-sm text-gray-200';
            el.innerHTML = `<span class="truncate">${name}</span><span class="text-[11px] text-gray-400">${count}</span>`;
            el.onclick = () => setCurrentStock(name);
            grid.appendChild(el);
        });
        const title = document.createElement('div');
        title.className = 'text-xs text-yellow-500 font-bold mb-2';
        title.textContent = '실시간 핫 토론방';
        box.innerHTML = '';
        box.appendChild(title);
        box.appendChild(grid);
        state.hotRoomsCache = { ts: Date.now(), html: box.innerHTML };
    } catch {
        box.innerHTML = '<div class="text-[11px] text-gray-500">핫 토론방을 불러오지 못했소.</div>';
    }
}

window.goToStockRoom = function() {
    const ip = document.getElementById('stock-room-input');
    if (!ip) return;
    const raw = (ip.value || '').trim();
    if (!raw) return;
    const v = resolveStockName(raw) || raw;
    navigate('stock-board');
    setTimeout(() => setCurrentStock(v), 0);
}

async function fetchStocksMaster() {
    try {
        const { data } = await client.from('stocks').select('code,name,market,keywords').order('market', { ascending: true });
        if (!Array.isArray(data)) return;
        state.stocksMaster = data;
        const map = {};
        data.forEach(s => {
            if (s.code && s.name) map[String(s.code).toUpperCase()] = s.name;
        });
        state.codeToName = map;
        try { localStorage.setItem('stocks_master', JSON.stringify(data)); } catch {}
        if (state.stockTags.length === 0) state.stockTags = data.slice(0, 60).map(s => s.name);
        renderStockOptions();
    } catch {}
}

function resolveStockName(input) {
    if (!input) return null;
    const v = String(input).trim();
    const upper = v.toUpperCase();
    if (state.codeToName && state.codeToName[upper]) return state.codeToName[upper];
    const exact = state.stocksMaster.find(s => s.name === v);
    if (exact) return exact.name;
    const byName = state.stocksMaster.find(s => s.name.startsWith(v)) || state.stocksMaster.find(s => s.name.includes(v));
    if (byName) return byName.name;
    const byKw = state.stocksMaster.find(s => s.keywords && s.keywords.includes(v));
    if (byKw) return byKw.name;
    return null;
}

function debounce(fn, wait) {
    let t;
    return function(...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    }
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function highlightText(text, query) {
    if (!query) return text;
    const q = query.trim();
    if (!q) return text;
    const re = new RegExp(escapeRegExp(q), 'gi');
    return text.replace(re, (m) => `<mark class="search-highlight">${m}</mark>`);
}
function getSearchOrder(type) {
    return state.searchOrderByType?.[type] || 'rank';
}
function setSearchOrder(type, order) {
    if (!state.searchOrderByType) state.searchOrderByType = {};
    state.searchOrderByType[type] = order || 'rank';
    try { localStorage.setItem(`search_order_${type}`, state.searchOrderByType[type]); } catch {}
}

async function searchStocksRPC(q) {
    if (!q || q.length < 1) return;
    try {
        const { data } = await client.rpc('search_stocks', { p_query: q, p_limit: 10 });
        if (!Array.isArray(data)) return;
        const opts = [];
        const seen = new Set();
        data.forEach(s => {
            const name = s.name;
            const code = s.code;
            if (name && !seen.has(name)) { opts.push({ v: name }); seen.add(name); }
            if (code && !seen.has(code)) { opts.push({ v: code }); seen.add(code); }
        });
        const dl = document.getElementById('stock-options');
        if (dl) {
            dl.innerHTML = opts.map(o => `<option value="${o.v}">`).join('');
        }
    } catch {}
}

function attachStockAutocomplete() {
    const inputIds = ['stock-room-input', 'stock-input'];
    inputIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el || el.__acBound) return;
        const handler = debounce(e => {
            const v = (el.value || '').trim();
            if (v) searchStocksRPC(v);
        }, 200);
        el.addEventListener('input', handler);
        el.__acBound = true;
    });
}

function setStockSortMode(mode) {
    state.stockSortMode = mode || 'latest';
    const ids = ['stock-sort-latest','stock-sort-top','stock-sort-views'];
    ids.forEach(id => {
        const b = document.getElementById(id);
        if (!b) return;
        const active = (mode === 'latest' && id.endsWith('latest')) || (mode === 'top' && id.endsWith('top')) || (mode === 'views' && id.endsWith('views'));
        b.className = `px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${active ? 'text-white bg-gray-700 shadow-sm' : 'text-gray-400 hover:text-white'}`;
    });
    renderPosts('posts-list-stock', 'stock', state.currentStockName || null);
}
window.setStockSortMode = setStockSortMode;
async function renderHomeStockRank(mode = 'today') {
    const list = document.getElementById('home-stock-rank-list');
    if (!list) return;
    list.innerHTML = '<div class="text-[11px] text-gray-500">랭킹을 불러오는 중...</div>';
    let hours = 24;
    if (mode === 'best') hours = 24 * 30;
    if (mode === 'week') hours = 24 * 7;
    let posts = [];
    try {
        const { data, error } = await client.rpc('get_top_posts', { p_hours: hours, p_type: 'stock', p_limit: 8 });
        if (!error && Array.isArray(data)) posts = data;
    } catch {}
    if (!posts.length) {
        try {
            const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
            const { data } = await client.from('posts')
                .select('id,title,stock_id,like_count,view_count,created_at')
                .eq('type','stock')
                .gte('created_at', since)
                .order('created_at', { ascending: false })
                .limit(50);
            posts = (data || []).sort((a,b)=> {
                const sa = Math.log1p(Number(a.like_count || 0))*2 + Math.log1p(Number(a.view_count || 0));
                const sb = Math.log1p(Number(b.like_count || 0))*2 + Math.log1p(Number(b.view_count || 0));
                return sb - sa;
            }).slice(0,8);
        } catch {}
    }
    if (!posts.length) { list.innerHTML = '<div class="text-[11px] text-gray-500">데이터 없음</div>'; return; }
    list.innerHTML = posts.map(p => {
        const title = p.title || '';
        const meta = `${p.stock_id || ''} · ♥${p.like_count || 0} · 👁${p.view_count || 0}`;
        return `<div class="row-item pressable" data-id="${p.id}">
            <div class="flex items-center justify-between gap-3">
                <div class="min-w-0"><span class="text-[13px] text-gray-200 line-clamp-1">${title}</span></div>
                <div class="text-[10px] text-gray-500 whitespace-nowrap">${meta}</div>
            </div>
        </div>`;
    }).join('');
    Array.from(list.children).forEach(el => {
        el.onclick = async () => {
            const id = el.getAttribute('data-id');
            const { data } = await client.from('posts').select(`*, profiles:user_id (nickname)`).eq('id', id).single();
            if (data) openPostDetail(data);
        };
        el.tabIndex = 0;
        el.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                el.click();
            }
        };
    });
    ['home-rank-best','home-rank-today','home-rank-week'].forEach(id => {
        const b = document.getElementById(id);
        if (!b) return;
        const active = (mode === 'best' && id.endsWith('best')) || (mode==='today' && id.endsWith('today')) || (mode==='week' && id.endsWith('week'));
        b.className = `px-2 py-1 text-[11px] rounded-md font-bold transition-all ${active ? 'bg-white text-black shadow-sm' : 'text-gray-400 hover:text-white'}`;
    });
}
async function fetchPosts(type, stockName = null, isLoadMore = false) {
    const pg = getPagination(type);
    if (pg.isLoading) return;
    pg.isLoading = true;

    if (!isLoadMore) {
        pg.page = 0;
        pg.hasMore = true;
    }

    const from = pg.page * pg.limit;
    const to = from + pg.limit - 1;

    if (state.searchQuery) {
        const q = state.searchQuery.replace(/,/g, ' ').trim();
        if (q) {
            let searchType = type;
            if (type === 'public') {
                const f = state.plazaFilterType || 'all';
                searchType = f === 'all' ? null : f;
            }
            try {
                const { data, error } = await client.rpc('search_posts_fts', { 
                    p_query: q, 
                    p_type: searchType, 
                    p_stock_id: type === 'stock' ? (stockName || null) : null, 
                    p_limit: pg.limit, 
                    p_offset: from 
                });
                pg.isLoading = false;
                if (!error && Array.isArray(data)) {
                    if (data.length < pg.limit) {
                        pg.hasMore = false;
                    } else {
                        pg.page++;
                    }
                    let posts = data.map(p => ({
                        ...p,
                        profiles: p.nickname ? { nickname: p.nickname } : null
                    }));
                    const order = getSearchOrder(type);
                    if (order === 'latest') {
                        posts = posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                    }
                    if (type === 'stock' && state.stockCategoryFilter && state.stockCategoryFilter !== 'all') {
                        posts = posts.filter(p => getCategory(p) === state.stockCategoryFilter);
                    }
                    const blocked = state.relationships.blocks;
                    const filtered = blocked.size ? posts.filter(p => !p.user_id || !blocked.has(p.user_id)) : posts;
                    return filtered;
                }
            } catch {}
        }
    }

    let query = client.from('posts')
        .select(`*, profiles:user_id (nickname, post_count, comment_count, avatar_url)`) 
        .order('created_at', { ascending: false })
        .range(from, to);
    if (type === 'public') {
        const f = state.plazaFilterType || 'all';
        if (f === 'all') {
            query = query.in('type', ['public','secret']);
        } else if (f === 'public') {
            query = query.eq('type', 'public');
        } else {
            query = query.eq('type', 'secret');
        }
    } else {
        query = query.eq('type', type);
    }

    if (stockName) query = query.eq('stock_id', stockName);
    if (type === 'stock' && state.stockCategoryFilter && state.stockCategoryFilter !== 'all') {
        query = query.eq('category', state.stockCategoryFilter);
    }
    if (state.searchQuery) {
        const q = state.searchQuery.replace(/,/g, ' ').trim();
        if (q) {
            if (type === 'stock') query = query.or(`title.ilike.%${q}%,content.ilike.%${q}%,stock_id.ilike.%${q}%`);
            else query = query.or(`title.ilike.%${q}%,content.ilike.%${q}%`);
        }
    }

    const { data, error } = await query;
    pg.isLoading = false;

    if (error) {
        showToast('비급을 불러오는 중 문제가 발생했습니다.', 'error');
        return [];
    }

    if (data.length < pg.limit) {
        pg.hasMore = false;
    } else {
        pg.page++;
    }
    let posts = data || [];
    if (type === 'stock') {
        const mode = state.stockSortMode || 'latest';
        if (mode === 'top') {
            posts = posts.sort((a, b) => {
                const sa = Math.log1p(Number(a.like_count || 0)) * 2 + Math.log1p(Number(a.view_count || 0));
                const sb = Math.log1p(Number(b.like_count || 0)) * 2 + Math.log1p(Number(b.view_count || 0));
                return sb - sa;
            });
        } else if (mode === 'views') {
            posts = posts.sort((a, b) => (Number(b.view_count || 0) - Number(a.view_count || 0)));
        }
        if (state.stockCategoryFilter && state.stockCategoryFilter !== 'all') {
            posts = posts.filter(p => getCategory(p) === state.stockCategoryFilter);
        }
    }
    const blocked = state.relationships.blocks;
    const filtered = blocked.size ? posts.filter(p => !p.user_id || !blocked.has(p.user_id)) : posts;
    return filtered;
}

function setStockCategory(cat) {
    state.stockCategoryFilter = cat || 'all';
    const ids = ['stock-cat-all','stock-cat-notice','stock-cat-question','stock-cat-analysis'];
    ids.forEach(id => {
        const b = document.getElementById(id);
        if (!b) return;
        const active =
          (cat === 'all' && id.endsWith('all')) ||
          (cat === 'notice' && id.endsWith('notice')) ||
          (cat === 'question' && id.endsWith('question')) ||
          (cat === 'analysis' && id.endsWith('analysis'));
        b.className = `px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${active ? 'bg-white text-black shadow-md' : 'text-gray-400 hover:text-white'}`;
    });
    renderPosts('posts-list-stock', 'stock', state.currentStockName || null);
}
window.setStockCategory = setStockCategory;

function getCategory(post) {
    if (post.category) return post.category;
    const t = (post.title || '').trim();
    if (/^\[?공지\]?/i.test(t)) return 'notice';
    if (/^\[?질문\]?/i.test(t)) return 'question';
    if (/^\[?분석\]?/i.test(t)) return 'analysis';
    return null;
}

async function renderStockRank(mode = 'best') {
    const list = document.getElementById('stock-rank-list');
    if (!list) return;
    list.innerHTML = '<div class="text-[11px] text-gray-500 p-3 col-span-full text-center">랭킹을 불러오는 중...</div>';
    let hours = 24 * 30;
    if (mode === 'today') hours = 24;
    else if (mode === 'week') hours = 24 * 7;
    let posts = [];
    try {
        const { data } = await client.rpc('get_top_posts', { p_hours: hours, p_type: 'stock', p_limit: 8 });
        if (Array.isArray(data)) posts = data;
    } catch {}
    if (!posts.length) {
        try {
            const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
            const { data } = await client.from('posts')
                .select(`*, profiles:user_id (nickname, avatar_url)`)
                .eq('type','stock')
                .gte('created_at', since)
                .order('created_at', { ascending: false })
                .limit(50);
            posts = (data || []).sort((a,b)=> {
                const sa = Math.log1p(Number(a.like_count || 0))*2 + Math.log1p(Number(a.view_count || 0));
                const sb = Math.log1p(Number(b.like_count || 0))*2 + Math.log1p(Number(b.view_count || 0));
                return sb - sa;
            }).slice(0,8);
        } catch {}
    }
    if (!posts.length) { list.innerHTML = '<div class="text-[11px] text-gray-500 p-3 col-span-full text-center">랭킹 데이터가 없소.</div>'; return; }
    
    list.innerHTML = posts.map(p => {
        const cat = getCategory(p);
        const catHtml = cat ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${
            cat === 'notice' ? 'bg-red-900/30 text-red-400' : 
            cat === 'question' ? 'bg-blue-900/30 text-blue-400' : 'bg-green-900/30 text-green-400'
        } mr-1">${cat === 'notice'?'공지':cat==='question'?'질문':'분석'}</span>` : '';
        const title = p.title || '';
        
        return `<div class="p-3 bg-black/20 rounded-xl border border-gray-800 hover:border-gray-600 transition-all cursor-pointer group flex flex-col justify-between h-full" data-id="${p.id}">
            <div>
                <div class="flex items-center justify-between mb-2">
                    <span class="text-[10px] font-bold text-yellow-500 truncate max-w-[80px]">${p.stock_id || '전체'}</span>
                    <span class="text-[10px] text-gray-500 group-hover:text-pink-500 transition-colors">♥ ${p.like_count || 0}</span>
                </div>
                <div class="text-sm text-gray-200 font-bold line-clamp-2 leading-snug mb-2 group-hover:text-white transition-colors">${title}</div>
            </div>
            <div class="flex items-center justify-between text-[10px] text-gray-500 mt-auto">
                <div class="flex items-center">${catHtml}</div>
                <span>👁 ${p.view_count || 0}</span>
            </div>
        </div>`;
    }).join('');

    Array.from(list.children).forEach(el => {
        el.onclick = async () => {
            const id = el.getAttribute('data-id');
            const { data } = await client.from('posts').select(`*, profiles:user_id (nickname)`).eq('id', id).single();
            if (data) openPostDetail(data);
        };
        el.tabIndex = 0;
        el.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                el.click();
            }
        };
    });

    ['rank-best','rank-today','rank-week'].forEach(id => {
        const b = document.getElementById(id);
        if (!b) return;
        const active = (mode === 'best' && id.endsWith('best')) || (mode==='today' && id.endsWith('today')) || (mode==='week' && id.endsWith('week'));
        b.className = `px-3 py-1 text-[10px] rounded-md font-bold transition-all ${active ? 'bg-white text-black shadow-sm' : 'text-gray-400 hover:text-white'}`;
    });
}

function createPostElement(post) {
    const author = post.profiles?.nickname || post.guest_nickname || '익명 무협객';
    const isSecret = post.type === 'secret';
    const time = new Date(post.created_at);
    const timeStr = `${time.getMonth()+1}/${time.getDate()}`;

    const postEl = document.createElement('div');
    postEl.className = 'row-item pressable cursor-pointer';
    postEl.dataset.postId = post.id;
    postEl.onclick = () => openPostDetail(post);
    postEl.tabIndex = 0;
    postEl.onkeydown = (e) => { if (e.key === 'Enter') openPostDetail(post); };
    observePostCard(postEl, post.id);
    
    const tag = isSecret ? '객잔' : (post.type === 'stock' ? (post.stock_id || '종목') : '');
    const cat = getCategory(post);
    const catHtml = cat ? `<span class="badge-cat ${cat} mr-1">${cat === 'notice' ? '공지' : cat === 'question' ? '질문' : '분석'}</span>` : '';
    const tagHtml = tag ? `<span class="badge-chip mr-2">${tag}</span>` : '';
    const titleText = post.title || '(제목 없음)';
    const titleHtml = state.searchQuery ? highlightText(titleText, state.searchQuery) : titleText;
    postEl.innerHTML = `
        <div class="flex items-center justify-between gap-3 w-full">
            <div class="min-w-0 flex items-center gap-2 w-full">
                ${tagHtml}${catHtml}
                <span class="text-[13px] text-gray-200 hover:text-yellow-400 line-clamp-1">${titleHtml}</span>
            </div>
            <div class="ml-3 flex items-center gap-2 flex-shrink-0 text-[10px] text-gray-500 whitespace-nowrap">
                <span>${timeStr}</span>
            </div>
        </div>
    `;
    return postEl;
}

async function loadRecommended() {
    const box = document.getElementById('recommended-feed');
    if (!box) return;
    box.innerHTML = '<div class="text-[11px] text-gray-500">추천을 계산하는 중...</div>';
    
    const mode = state.recommendedMode || 'mix';
    const cacheKey = `${state.user ? state.user.id : 'anon'}:${mode}`;
    const cached = state.recommendedCache[cacheKey];
    
    if (cached && (Date.now() - cached.ts) < 10 * 60 * 1000) {
        renderRecommendedFromPosts(cached.posts, mode);
        return;
    }

    let posts = [];
    try {
        if (state.user) {
            const { data } = await client.rpc('get_recommended_posts', { p_user: state.user.id, p_limit: 30 });
            posts = data || [];
        } else {
            posts = await fetchPosts('public', null, false);
        }
    } catch {
        posts = await fetchPosts('public', null, false);
    }

    state.recommendedCache[cacheKey] = { ts: Date.now(), posts };
    renderRecommendedFromPosts(posts, mode);
}

function renderRecommendedFromPosts(posts, mode) {
    const box = document.getElementById('recommended-feed');
    if (!box) return;

    const mutes = state.relationships.mutes;
    const blocks = state.relationships.blocks;
    const notis = state.notInterestedPostIds;

    let filtered = posts.filter(p => {
        const uid = p.user_id;
        if (uid && (mutes.has(uid) || blocks.has(uid))) return false;
        if (notis.has(p.id)) return false;
        return true;
    });

    if (!state.includeSecretInReco) filtered = filtered.filter(p => p.type !== 'secret');

    // Sorting & Scoring
    if (mode === 'follow') {
        const follows = state.relationships.follows;
        filtered = filtered.filter(p => p.user_id && follows.has(p.user_id));
    } else if (mode === 'new') {
        filtered = filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else {
        const follows = state.relationships.follows;
        const now = Date.now();
        const score = (p) => {
            const followBoost = p.user_id && follows.has(p.user_id) ? 2 : 0;
            const react = Math.log1p(Number(p.like_count || 0)) * 1.5 + Math.log1p(Number(p.view_count || 0)) * 0.5;
            const ageHrs = Math.max(0, (now - new Date(p.created_at).getTime()) / 3600000);
            const recency = Math.exp(-ageHrs / 72) * 3;
            return followBoost + react + recency;
        };
        filtered = filtered.sort((a, b) => score(b) - score(a));
    }

    filtered = filtered.slice(0, 6);
    box.innerHTML = '';
    if (filtered.length === 0) {
        box.innerHTML = '<div class="text-[11px] text-gray-500 py-4">추천할 비급이 없소.</div>';
        return;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach(p => frag.appendChild(createPostElement(p)));
    box.appendChild(frag);
}

window.setRecommendedMode = function(mode) {
    state.recommendedMode = mode;
    ['reco-tab-mix','reco-tab-follow','reco-tab-new','reco-tab-similar'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const active = (mode === 'mix' && id.endsWith('mix')) || (mode === 'follow' && id.endsWith('follow')) || (mode === 'new' && id.endsWith('new')) || (mode === 'similar' && id.endsWith('similar'));
        el.className = `px-3 py-1.5 text-[11px] rounded-full border ${active ? 'bg-yellow-700 text-black border-yellow-600' : 'bg-[#1C1C1E] text-gray-300 border-gray-800'}`;
    });
    loadRecommended();
};

async function fetchMyRelationships() {
    try {
        const { data, error } = await client.from('user_relationships').select('target_id,type').eq('user_id', state.user.id);
        if (error) return;
        const follows = new Set();
        const blocks = new Set();
        const mutes = new Set();
        (data || []).forEach(r => {
            if (r.type === 'follow') follows.add(r.target_id);
            else if (r.type === 'block') blocks.add(r.target_id);
            else if (r.type === 'mute') mutes.add(r.target_id);
        });
        state.relationships = { follows, blocks, mutes };
    } catch (e) {}
}

window.openUserSheet = function(userId, userName, userAvatar) {
    if (!state.user || !userId || userId === state.user.id) return;
    state.currentTargetUserId = userId;
    const sheet = document.getElementById('userActionSheet');
    const nameEl = document.getElementById('user-sheet-name');
    const avatarEl = document.getElementById('user-sheet-avatar');
    const msgBtn = document.getElementById('sheet-msg-btn');
    const profileBtn = document.getElementById('sheet-profile-btn');
    const followBtn = document.getElementById('follow-btn');
    const blockBtn = document.getElementById('block-btn');
    nameEl.innerText = userName || '알 수 없음';
    avatarEl.src = userAvatar || '';
    avatarEl.classList.toggle('hidden', !userAvatar);
    avatarEl.onerror = () => avatarEl.classList.add('hidden');
    msgBtn.onclick = () => { openMessageCompose(userId, userName); closeModal('userActionSheet'); };
    profileBtn.onclick = () => { openProfileView(userId); closeModal('userActionSheet'); };
    const isFollow = state.relationships.follows.has(userId);
    const isBlock = state.relationships.blocks.has(userId);
    followBtn.innerText = isFollow ? '팔로우 해제' : '팔로우';
    blockBtn.innerText = isBlock ? '차단 해제' : '차단';
    followBtn.onclick = async () => { await toggleRelationship('follow', userId); openUserSheet(userId, userName, userAvatar); };
    blockBtn.onclick = async () => { await toggleRelationship('block', userId); openUserSheet(userId, userName, userAvatar); };
    sheet.classList.remove('hidden');
};

window.openProfileView = async function(userId) {
    const modal = document.getElementById('profileViewModal');
    if (!userId) return;
    const { data: profile } = await client.from('profiles').select('*').eq('id', userId).single();
    if (!profile) return;
    const nameEl = document.getElementById('pv-name');
    const avatarEl = document.getElementById('pv-avatar');
    const statsEl = document.getElementById('pv-stats');
    const cardEl = document.getElementById('pv-card').firstElementChild;
    nameEl.innerText = profile.nickname || '익명 협객';
    avatarEl.src = profile.avatar_url || '';
    avatarEl.classList.toggle('hidden', !profile.avatar_url);
    avatarEl.onerror = () => avatarEl.classList.add('hidden');
    if (cardEl) {
        if (profile.banner_url) {
            cardEl.style.backgroundImage = `url('${profile.banner_url}')`;
            cardEl.style.backgroundSize = 'cover';
            cardEl.style.backgroundPosition = 'center';
        } else {
            cardEl.style.backgroundImage = '';
        }
    }
    statsEl.innerText = `비급 ${profile.post_count || 0} · 전서 ${profile.comment_count || 0}`;
    const msgBtn = document.getElementById('pv-msg-btn');
    const followBtn = document.getElementById('pv-follow-btn');
    const blockBtn = document.getElementById('pv-block-btn');
    msgBtn.onclick = () => { openMessageCompose(userId, profile.nickname || '협객'); };
    const isFollow = state.relationships.follows.has(userId);
    const isBlock = state.relationships.blocks.has(userId);
    followBtn.innerText = isFollow ? '팔로우 해제' : '팔로우';
    blockBtn.innerText = isBlock ? '차단 해제' : '차단';
    followBtn.onclick = async () => { await toggleRelationship('follow', userId); openProfileView(userId); };
    blockBtn.onclick = async () => { await toggleRelationship('block', userId); openProfileView(userId); };
    const list = document.getElementById('pv-posts-list');
    list.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">비급을 찾는 중...</div>';
    const { data: posts } = await client.from('posts')
        .select(`*, profiles:user_id (nickname, post_count, comment_count, avatar_url)`)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);
    list.innerHTML = '';
    if (!posts || posts.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">최근에 올린 비급이 없소.</div>';
    } else {
        posts.forEach(p => {
            const el = document.createElement('div');
            el.className = 'py-1.5 border-b border-gray-700 last:border-b-0 flex items-center justify-between cursor-pointer';
            el.innerHTML = `<span class="min-w-0 flex-1 text-sm text-white truncate">${p.title}</span><span class="text-[10px] text-gray-500 whitespace-nowrap">${new Date(p.created_at).toLocaleDateString()}</span>`;
            el.onclick = () => { closeModal('profileViewModal'); openPostDetail(p); };
            list.appendChild(el);
        });
    }
    modal.classList.remove('hidden');
};
async function toggleRelationship(type, targetId) {
    if (!targetId) return;
    if (!state.user) { requireAuth(type === 'follow' ? '팔로우' : type === 'block' ? '차단' : '뮤트'); return; }
    const set = type === 'follow' ? state.relationships.follows
              : type === 'block' ? state.relationships.blocks
              : state.relationships.mutes;
    try {
        if (set.has(targetId)) {
            await client.from('user_relationships').delete().match({ user_id: state.user.id, target_id: targetId, type });
            set.delete(targetId);
            if (type === 'block') {}
        } else {
            await client.from('user_relationships').insert({ user_id: state.user.id, target_id: targetId, type });
            set.add(targetId);
        }
        showToast(type === 'follow'
            ? (set.has(targetId) ? '팔로우했습니다.' : '팔로우를 해제했습니다.')
            : type === 'block'
              ? (set.has(targetId) ? '차단했습니다.' : '차단을 해제했습니다.')
              : (set.has(targetId) ? '뮤트했습니다.' : '뮤트를 해제했습니다.'),
            'success');
    } catch (e) {
        showToast('처리에 차질이 생겼소.', 'error');
    }
}

async function renderPosts(containerId, type, stockName = null) {
    const container = document.getElementById(containerId);
    
    // 검색바 주입
    let searchContainer = document.getElementById(`search-${type}`);
    if (!searchContainer) {
        const searchDiv = document.createElement('div');
        searchDiv.id = `search-${type}`;
        searchDiv.className = 'mb-2 flex items-center justify-between flex-wrap gap-2';
        const toggleHtml = type === 'public' 
            ? `<label class="flex items-center gap-2 text-xs text-gray-300 px-2">
                    <input type="checkbox" ${state.includeSecretInPlaza ? 'checked' : ''} onchange="toggleIncludeSecretPlaza(this.checked)" class="w-4 h-4 rounded border-gray-600 bg-gray-800 text-yellow-500 focus:ring-0">
                    객잔 포함
               </label>`
            : '';
        const order = getSearchOrder(type);
        searchDiv.innerHTML = `
            <input id="search-input-${type}" type="text" placeholder="비급 제목 검색..." class="flex-grow bg-gray-800 border border-gray-700 text-white px-2 py-1.5 rounded-lg text-xs h-8" onkeydown="if(event.key==='Enter') handleSearch('${type}', '${containerId}', '${stockName || ''}', this.value)">
            <button onclick="handleSearch('${type}', '${containerId}', '${stockName || ''}', this.previousElementSibling.value)" class="bg-gray-700 text-white px-3 py-1.5 rounded-lg text-xs h-8 hover:bg-gray-600">검색</button>
            <select class="bg-gray-800 border border-gray-700 text-white px-2 py-1.5 rounded-lg text-xs h-8" onchange="setSearchOrderUI('${type}','${containerId}','${stockName || ''}', this.value)">
                <option value="rank" ${order === 'rank' ? 'selected' : ''}>관련도</option>
                <option value="latest" ${order === 'latest' ? 'selected' : ''}>최신</option>
            </select>
            ${toggleHtml}
        `;
        container.parentNode.insertBefore(searchDiv, container);
        if (type === 'public' && !document.getElementById('plaza-filter-bar')) {
            const bar = document.createElement('div');
            bar.id = 'plaza-filter-bar';
            bar.className = 'flex gap-1';
            const mk = (id, label, val) => {
                const b = document.createElement('button');
                b.id = id;
                b.className = `px-3 py-1.5 rounded-full text-[11px] border ${state.plazaFilterType === val ? 'bg-yellow-700 text-black border-yellow-600' : 'bg-[#1C1C1E] text-gray-300 border-gray-800'}`;
                b.textContent = label;
                b.onclick = () => setPlazaFilter(val);
                return b;
            };
            bar.appendChild(mk('plaza-filter-all','전체','all'));
            bar.appendChild(mk('plaza-filter-public','공개','public'));
            bar.appendChild(mk('plaza-filter-secret','객잔','secret'));
            const left = document.createElement('div');
            left.className = 'flex items-center gap-2';
            left.appendChild(bar);
            const right = document.createElement('div');
            right.className = 'flex items-center gap-2';
            // Move search elements into right container
            Array.from(searchDiv.childNodes).forEach(n => {
                if (n.tagName === 'INPUT' || n.tagName === 'BUTTON' || n.tagName === 'SELECT') right.appendChild(n);
            });
            searchDiv.innerHTML = '';
            searchDiv.appendChild(left);
            searchDiv.appendChild(right);
        }
    }

    container.innerHTML = Array.from({ length: 3 }).map(() => `
        <div class="animate-pulse p-3 rounded-xl bg-gray-800/30 border border-gray-800 mb-2">
            <div class="h-4 bg-gray-700/50 rounded w-2/3 mb-2"></div>
            <div class="h-3 bg-gray-700/40 rounded w-1/3"></div>
        </div>
    `).join('');
    state.searchQuery = ''; 
    
    const posts = await fetchPosts(type, stockName, false);
    container.innerHTML = ''; 

    if (!posts || posts.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 py-10">등록된 비급이 없습니다.</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    posts.forEach(post => fragment.appendChild(createPostElement(post)));
    container.appendChild(fragment);

    state.lastRenderedType = type;
    state.lastRenderedPosts = posts;

    renderLoadMoreButton(container, type, stockName);
    setupInfiniteScroll(container, type, stockName);
}

window.handleSearch = async function(type, containerId, stockName, query) {
    state.searchQuery = query;
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<div class="text-center text-gray-500 py-10">... 비급을 찾는 중 ...</div>';
    
    const posts = await fetchPosts(type, stockName || null, false);
    container.innerHTML = '';

    if (!posts || posts.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 py-10">검색된 비급이 없습니다.</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    posts.forEach(post => fragment.appendChild(createPostElement(post)));
    container.appendChild(fragment);

    renderLoadMoreButton(container, type, stockName || null);
    setupInfiniteScroll(container, type, stockName || null);

    if (type === 'public') loadRecommended();
}
window.setSearchOrderUI = function(type, containerId, stockName, order) {
    setSearchOrder(type, order);
    const input = document.getElementById(`search-input-${type}`);
    const q = (input?.value || '').trim();
    if (q) handleSearch(type, containerId, stockName || null, q);
    else renderPosts(containerId, type, stockName || null);
}
window.toggleIncludeSecretPlaza = function(checked) {
    state.includeSecretInPlaza = !!checked;
    try { localStorage.setItem('include_secret_plaza', JSON.stringify(state.includeSecretInPlaza)); } catch {}
    state.searchQuery = '';
    renderPosts('posts-list-public', 'public');
    setupRealtimePostsForView();
}
window.setPlazaFilter = function(val) {
    state.plazaFilterType = val;
    try { localStorage.setItem('plaza_filter', val); } catch {}
    const bar = document.getElementById('plaza-filter-bar');
    if (bar) {
        Array.from(bar.children).forEach(btn => {
            const v = btn.id.endsWith('all') ? 'all' : btn.id.endsWith('public') ? 'public' : 'secret';
            btn.className = `px-3 py-1.5 rounded-full text-[11px] border ${state.plazaFilterType === v ? 'bg-yellow-700 text-black border-yellow-600' : 'bg-[#1C1C1E] text-gray-300 border-gray-800'}`;
        });
    }
    renderPosts('posts-list-public', 'public');
    setupRealtimePostsForView();
}

function renderLoadMoreButton(container, type, stockName) {
    const existingBtn = container.nextElementSibling;
    if (existingBtn && existingBtn.id === 'load-more-btn') existingBtn.remove();

    const pg = getPagination(type);
    if (pg.hasMore) {
        const btn = document.createElement('button');
        btn.id = 'load-more-btn';
        btn.className = 'w-full py-3 mt-4 text-sm text-gray-400 bg-gray-800/50 rounded-lg hover:bg-gray-800 hover:text-white transition';
        btn.innerText = '비급 더 찾기';
        btn.onclick = async () => {
            btn.innerText = '비급을 찾는 중...';
            const posts = await fetchPosts(type, stockName, true);
            if (posts.length > 0) {
                const fragment = document.createDocumentFragment();
                posts.forEach(post => fragment.appendChild(createPostElement(post)));
                container.appendChild(fragment);
            }
            if (!pg.hasMore) btn.remove();
            else btn.innerText = '비급 더 찾기';
        };
        container.parentNode.appendChild(btn);
    }
}
function setupInfiniteScroll(container, type, stockName) {
    const key = `${container.id}_${type}`;
    const prev = state.infiniteObservers?.[key];
    if (prev) {
        try { prev.observer.disconnect(); } catch {}
        if (prev.sentinel && prev.sentinel.parentNode) prev.sentinel.parentNode.removeChild(prev.sentinel);
    }
    const sentinel = document.createElement('div');
    sentinel.className = 'h-6 w-full';
    container.parentNode.appendChild(sentinel);
    const observer = new IntersectionObserver(async (entries) => {
        const entry = entries[0];
        if (!entry.isIntersecting) return;
        const pg = getPagination(type);
        if (!pg.hasMore || pg.isLoading) return;
        const posts = await fetchPosts(type, stockName, true);
        if (posts.length > 0) {
            const fragment = document.createDocumentFragment();
            posts.forEach(post => fragment.appendChild(createPostElement(post)));
            container.appendChild(fragment);
        }
        renderLoadMoreButton(container, type, stockName);
    }, { root: null, rootMargin: '200px', threshold: 0.1 });
    observer.observe(sentinel);
    if (!state.infiniteObservers) state.infiniteObservers = {};
    state.infiniteObservers[key] = { observer, sentinel };
}

window.openPostDetail = async function(post) {
    state.currentPostId = post.id;
    state.postToEdit = post;
    navigate('post-detail');
    recordPostClick(post.id);
    
    const viewsEl = document.getElementById('detail-views');
    if (viewsEl) {
        viewsEl.innerText = post.view_count || 0;
        setTimeout(async () => {
            try {
                const { data } = await client.from('posts').select('view_count').eq('id', post.id).single();
                if (data) viewsEl.innerText = data.view_count || 0;
            } catch {}
        }, 600);
    }

    const titleEl = document.getElementById('detail-title');
    if (titleEl) titleEl.innerText = post.title;
    const contentEl = document.getElementById('detail-content');
    if (contentEl) contentEl.innerHTML = linkifyHtml(post.content);
    
    const author = post.profiles?.nickname || post.guest_nickname || '익명 무협객';
    const authorEl = document.getElementById('detail-author');
    if (authorEl) authorEl.innerText = author;
    const dateEl = document.getElementById('detail-date');
    if (dateEl) dateEl.innerText = new Date(post.created_at).toLocaleString();
    const likesEl = document.getElementById('detail-likes');
    if (likesEl) likesEl.innerText = post.like_count || 0;

    const metaContainer = document.getElementById('detail-meta-container');
    if (metaContainer) metaContainer.classList.toggle('hidden', post.type === 'secret');
    
    const isAuthor = state.user?.id === post.user_id;
    const isAdmin = state.profile?.role === 'admin';
    const canEdit = isAuthor || isAdmin;
    const canDelete = isAuthor || isAdmin;
    const delBtn = document.getElementById('delete-post-btn');
    if (delBtn) delBtn.classList.toggle('hidden', !canDelete);
    const editBtn = document.getElementById('edit-post-btn');
    if (editBtn) editBtn.classList.toggle('hidden', !canEdit);
    
    // 쪽지 보내기 버튼 로직
    const msgBtn = document.getElementById('btn-send-msg');
    if (msgBtn) {
        // 로그인 상태이고, 작성자가 본인이 아니며, 작성자가 익명이 아닐 때
        const canSendMsg = state.user && !isAuthor && post.user_id;
        msgBtn.classList.toggle('hidden', !canSendMsg);
        msgBtn.onclick = () => openMessageCompose(post.user_id, author);
    }
    const shareBtn = document.getElementById('btn-share-link');
    if (shareBtn) {
        shareBtn.onclick = async () => {
            const url = `${window.location.origin}${window.location.pathname}#post-${post.id}`;
            try {
                await navigator.clipboard.writeText(url);
                showToast('링크를 복사했소.', 'success');
            } catch {
                const tmp = document.createElement('input');
                tmp.value = url;
                document.body.appendChild(tmp);
                tmp.select();
                document.execCommand('copy');
                document.body.removeChild(tmp);
                showToast('링크를 복사했소.', 'success');
            }
        };
    }
    const t1 = document.getElementById('detail-include-secret-toggle');
    if (t1) {
        t1.checked = !!state.includeSecretInPlaza;
        t1.onchange = (e) => { toggleIncludeSecretPlaza(e.target.checked); loadRelatedPosts(post); };
    }
    const t2 = document.getElementById('detail-include-secret-toggle-modal');
    if (t2) {
        t2.checked = !!state.includeSecretInPlaza;
        t2.onchange = (e) => { toggleIncludeSecretPlaza(e.target.checked); loadRelatedPosts(post); };
    }
    renderPrevNextControls(post);
    await loadRelatedPosts(post);
    await loadComments(post.id);
    setupCommentAutoResize();
    const cmt = document.getElementById('comment-input');
    if (cmt) {
        if (!state.user) {
            cmt.setAttribute('readonly','true');
            cmt.placeholder = '입문 후 전서를 남길 수 있소. 눌러 입문.';
            cmt.onclick = () => openModal('authModal');
        } else {
            cmt.removeAttribute('readonly');
            cmt.placeholder = '전서(댓글)를 남기시오...';
            cmt.onclick = null;
        }
    }
    if (delBtn) {
        delBtn.onclick = () => {
            const cdt = document.getElementById('confirm-delete-title');
            if (cdt) cdt.innerText = state.postToEdit.title;
            openModal('deleteConfirmModal');
        };
    }
    if (editBtn) editBtn.onclick = () => openPostEditModal(post);
    const targetHash = `#post-${post.id}`;
    if (window.location.hash !== targetHash) {
        window.history.pushState({ view: 'post', postId: post.id }, null, targetHash);
    }
}

async function recordPostClick(postId) {
    if (!state.user || !postId || !state.dataCollectionEnabled) return;
    try {
        await client.from('post_clicks').upsert(
            { user_id: state.user.id, post_id: postId },
            { onConflict: 'user_id,post_id', ignoreDuplicates: true }
        );
    } catch {}
}
async function recordPostImpression(postId) {
    if (!state.user || !postId || !state.dataCollectionEnabled) return;
    if (state.impressed.has(postId)) return;
    state.impressed.add(postId);
    try { await client.from('post_impressions').insert({ user_id: state.user.id, post_id: postId }); } catch {}
}
let __impObserver = null;
const __impTimers = {};
function ensureImpressionObserver() {
    if (__impObserver) return;
    __impObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            const el = entry.target;
            const pid = el.dataset.postId;
            if (!pid) return;
            if (entry.isIntersecting) {
                if (__impTimers[pid]) clearTimeout(__impTimers[pid]);
                __impTimers[pid] = setTimeout(() => {
                    recordPostImpression(pid);
                }, 1500);
            } else {
                if (__impTimers[pid]) {
                    clearTimeout(__impTimers[pid]);
                    delete __impTimers[pid];
                }
            }
        });
    }, { threshold: 0.5 });
}
function observePostCard(el, postId) {
    if (!state.user || !state.dataCollectionEnabled) return;
    ensureImpressionObserver();
    try { __impObserver.observe(el); } catch {}
}
async function markNotInterested(postId) {
    if (!state.user || !postId) return;
    try {
        await client.from('post_feedbacks').insert({ user_id: state.user.id, post_id: postId, type: 'not_interested' });
        state.notInterestedPostIds.add(postId);
        showToast('추천에서 제외했소.', 'success');
        const el = document.querySelector(`[data-post-id="${postId}"]`);
        if (el && el.parentNode && el.parentNode.id === 'recommended-feed') el.remove();
    } catch { showToast('처리에 차질이 있소.', 'error'); }
}
async function muteAuthor(targetUserId) {
    if (!state.user || !targetUserId) return;
    try {
        await client.from('user_relationships').insert({ user_id: state.user.id, target_id: targetUserId, type: 'mute' });
        state.relationships.mutes.add(targetUserId);
        showToast('작성자를 숨겼소.', 'success');
        document.querySelectorAll(`[data-post-id]`).forEach(el => {
            const pid = el.getAttribute('data-post-id');
        });
        loadRecommended();
    } catch { showToast('처리에 차질이 있소.', 'error'); }
}

function autoResizeTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(200, Math.max(44, el.scrollHeight)) + 'px';
}

function setupCommentAutoResize() {
    const ids = ['comment-input','comment-input-modal'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        autoResizeTextarea(el);
        el.addEventListener('input', () => autoResizeTextarea(el));
    });
}
function renderPrevNextControls(post) {
    const idx = Array.isArray(state.lastRenderedPosts) ? state.lastRenderedPosts.findIndex(p => p.id === post.id) : -1;
    const prev = idx > 0 ? state.lastRenderedPosts[idx - 1] : null;
    const next = (idx >= 0 && idx < (state.lastRenderedPosts.length - 1)) ? state.lastRenderedPosts[idx + 1] : null;
    const makeBtn = (p, label) => {
        const b = document.createElement('button');
        b.className = 'text-[11px] text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-800';
        b.textContent = label;
        b.onclick = async () => {
            const { data: fullPost } = await client.from('posts')
                .select(`*, profiles:user_id (nickname, post_count, comment_count, avatar_url)`)
                .eq('id', p.id)
                .single();
            if (fullPost) openPostDetail(fullPost);
        };
        return b;
    };
    ['detail-prev-next','detail-prev-next-modal'].forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;
        container.innerHTML = '';
        const backBtn = document.createElement('button');
        backBtn.className = 'text-[11px] text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-800';
        backBtn.textContent = '목록으로';
        backBtn.onclick = () => {
            const t = state.lastRenderedType || 'public';
            const view = t === 'stock' ? 'stock-board' : t === 'secret' ? 'secret-inn' : 'gangho-plaza';
            navigate(view);
        };
        container.appendChild(backBtn);
        if (prev) container.appendChild(makeBtn(prev, '이전'));
        if (next) container.appendChild(makeBtn(next, '다음'));
    });
}
async function loadRelatedPosts(currentPost) {
    try {
        let query = client.from('posts')
            .select(`id, user_id, title, type, stock_id, like_count, created_at, profiles:user_id (nickname)`)
            .neq('id', currentPost.id)
            .order('created_at', { ascending: false })
            .limit(10);
        if (currentPost.type === 'stock') {
            query = query.eq('type', 'stock').eq('stock_id', currentPost.stock_id);
        } else if (currentPost.type === 'public') {
            query = state.includeSecretInPlaza ? query.in('type', ['public','secret']) : query.eq('type', 'public');
        } else {
            query = query.eq('type', 'secret');
        }
        const { data } = await query;
        let posts = data || [];
        const kw = (currentPost.title || '').split(/\s+/).filter(w => w.length >= 2);
        const now = Date.now();
        posts = posts.sort((a, b) => {
            const sa_kw = kw.reduce((acc, w) => acc + ((a.title || '').includes(w) ? 1 : 0), 0);
            const sb_kw = kw.reduce((acc, w) => acc + ((b.title || '').includes(w) ? 1 : 0), 0);
            const sa_like = Math.min(5, Math.max(0, (a.like_count || 0))) / 5; // 0~1
            const sb_like = Math.min(5, Math.max(0, (b.like_count || 0))) / 5;
            const sa_time = Math.max(0, 1 - Math.min(1, (now - new Date(a.created_at).getTime()) / (14 * 24 * 3600 * 1000))); // 최근 14일 0~1
            const sb_time = Math.max(0, 1 - Math.min(1, (now - new Date(b.created_at).getTime()) / (14 * 24 * 3600 * 1000)));
            const sa = sa_kw * 2 + sa_like + sa_time;
            const sb = sb_kw * 2 + sb_like + sb_time;
            return sb - sa;
        });
        const blocked = state.relationships.blocks;
        const filtered = blocked.size ? posts.filter(p => !p.user_id || !blocked.has(p.user_id)) : posts;
        const follows = state.relationships.follows;
        const liked = state.likedPostIds || new Set();
        const final = filtered.sort((a, b) => {
            const fa = follows.size && a.user_id && follows.has(a.user_id) ? 1 : 0;
            const fb = follows.size && b.user_id && follows.has(b.user_id) ? 1 : 0;
            const la = liked.has(a.id) ? 1 : 0;
            const lb = liked.has(b.id) ? 1 : 0;
            return (fb + lb) - (fa + la);
        });
        ['related-posts','related-posts-modal'].forEach(id => {
            const list = document.getElementById(id);
            if (!list) return;
            list.innerHTML = '';
            if (!final.length) {
                list.innerHTML = '<div class="text-center text-gray-500 py-4 text-xs">표시할 비급이 없소.</div>';
                return;
            }
            const frag = document.createDocumentFragment();
            final.forEach(p => {
                const el = document.createElement('div');
                el.className = 'py-1.5 border-b border-gray-700 last:border-b-0 flex items-center justify-between';
                const date = new Date(p.created_at).toLocaleDateString();
                el.innerHTML = `<div class="min-w-0 flex-1 text-xs text-white truncate">${p.title}</div><div class="text-[10px] text-gray-500 whitespace-nowrap">${date}</div>`;
                el.onclick = async () => {
                    const { data: fullPost } = await client.from('posts')
                        .select(`*, profiles:user_id (nickname, post_count, comment_count, avatar_url)`)
                        .eq('id', p.id)
                        .single();
                    if (fullPost) openPostDetail(fullPost);
                };
                frag.appendChild(el);
            });
            list.appendChild(frag);
        });
    } catch {}
}
async function renderRanking() {
    const guildList = document.getElementById('guild-ranking-list');
    const guildMemberList = document.getElementById('guild-member-ranking-list');
    const bestList = document.getElementById('best-posts-list');
    if (guildList) guildList.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">문파 랭킹을 계산 중...</div>';
    if (guildMemberList) guildMemberList.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">가입자 랭킹을 계산 중...</div>';
    if (bestList) bestList.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">베스트 비급을 불러오는 중...</div>';
    if (state.stockTags.length === 0) await fetchStockTags();
    const tags = [...state.stockTags];
    const counts = await Promise.all(tags.map(async name => {
        const { count } = await client.from('posts')
            .select('*', { count: 'exact', head: true })
            .eq('type', 'stock')
            .eq('stock_id', name);
        return { name, count: count || 0 };
    }));
    counts.sort((a, b) => b.count - a.count);
    if (guildList) {
        guildList.innerHTML = '';
        counts.slice(0, 10).forEach(({ name, count }, idx) => {
            const el = document.createElement('div');
            el.className = 'card-elegant p-3 flex items-center justify-between';
            el.innerHTML = `<div class="flex items-center gap-2"><span class="text-xs text-gray-500">${idx + 1}</span><span class="text-sm text-white font-bold">${name}</span></div><div class="text-xs text-yellow-400">비급 ${count}</div>`;
            el.onclick = () => { state.currentStockName = name; navigate('guild-detail'); };
            guildList.appendChild(el);
        });
        if (guildList.childElementCount === 0) guildList.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">등록된 문파가 없소.</div>';
    }
    if (guildMemberList) {
        const memCounts = await Promise.all(tags.map(async name => {
            try {
                const { count } = await client.from('guild_memberships')
                    .select('*', { count: 'exact', head: true })
                    .eq('stock_id', name);
                return { name, count: count || 0 };
            } catch { return { name, count: 0 }; }
        }));
        memCounts.sort((a, b) => b.count - a.count);
        guildMemberList.innerHTML = '';
        memCounts.slice(0, 10).forEach(({ name, count }, idx) => {
            const el = document.createElement('div');
            el.className = 'card-elegant p-3 flex items-center justify-between';
            el.innerHTML = `<div class="flex items-center gap-2"><span class="text-xs text-gray-500">${idx + 1}</span><span class="text-sm text-white font-bold">${name}</span></div><div class="text-xs text-yellow-400">가입자 ${count}</div>`;
            el.onclick = () => { state.currentStockName = name; navigate('guild-detail'); };
            guildMemberList.appendChild(el);
        });
        if (guildMemberList.childElementCount === 0) guildMemberList.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">등록된 문파가 없소.</div>';
    }
    const { data: posts } = await client.from('posts')
        .select(`*, profiles:user_id (nickname, post_count, comment_count)`)
        .neq('type', 'secret')
        .order('like_count', { ascending: false })
        .limit(10);
    if (bestList) {
        bestList.innerHTML = '';
        (posts || []).forEach(post => {
            const el = document.createElement('div');
            el.className = 'card-elegant p-3 cursor-pointer';
            const like = post.like_count || 0;
            const stock = post.type === 'stock' ? ` · ${post.stock_id}` : '';
            el.innerHTML = `<div class="flex justify-between items-center mb-1"><span class="text-sm text-white truncate">${post.title}${stock}</span><span class="text-xs text-yellow-400">♥ ${like}</span></div><div class="text-[11px] text-gray-500">${new Date(post.created_at).toLocaleDateString()}</div>`;
            el.onclick = () => openPostDetail(post);
            bestList.appendChild(el);
        });
        if (bestList.childElementCount === 0) bestList.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">비급이 없소.</div>';
    }
}

async function renderGuildDetail(name) {
    const titleEl = document.getElementById('guild-detail-title');
    if (titleEl) titleEl.textContent = `문파 상세 — ${name}`;
    const btn = document.getElementById('guild-join-btn');
    const joined = getGuildMembership(name);
    if (btn) btn.textContent = joined ? '탈퇴' : '가입';
    try {
        const { count } = await client.from('guild_memberships').select('*', { count: 'exact', head: true }).eq('stock_id', name);
        const cEl = document.getElementById('guild-member-count');
        if (cEl) cEl.textContent = String(count || 0);
    } catch {}
    const posts = await fetchPosts('stock', name);
    const list = document.getElementById('guild-posts');
    if (list) {
        list.innerHTML = '';
        (posts || []).forEach(p => list.appendChild(createPostElement(p)));
        if (!list.childElementCount) list.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">비급이 없소.</div>';
    }
    const { data: topPosts } = await client.from('posts')
        .select(`*, profiles:user_id (nickname, post_count, comment_count)`)
        .eq('type', 'stock')
        .eq('stock_id', name)
        .order('like_count', { ascending: false })
        .limit(10);
    const lb = document.getElementById('guild-leaderboard');
    if (lb) {
        lb.innerHTML = '';
        (topPosts || []).forEach(post => {
            const el = document.createElement('div');
            el.className = 'card-elegant p-3 flex items-center justify-between';
            el.innerHTML = `<div class="text-sm text-white truncate">${post.title}</div><div class="text-xs text-yellow-400">♥ ${post.like_count || 0}</div>`;
            lb.appendChild(el);
        });
        if (!lb.childElementCount) lb.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">리더보드가 비었소.</div>';
    }
}
function getGuildMembershipKey() {
    return `guild_memberships_${state.user?.id || 'guest'}`;
}
function getGuildMembership(name) {
    try {
        const raw = localStorage.getItem(getGuildMembershipKey());
        const obj = raw ? JSON.parse(raw) : {};
        return !!obj[name];
    } catch { return false; }
}
window.toggleGuildMembership = async function() {
    const name = state.currentStockName;
    const key = getGuildMembershipKey();
    let obj = {};
    try {
        obj = JSON.parse(localStorage.getItem(key) || '{}');
    } catch {}
    const joined = !!obj[name];
    obj[name] = !joined;
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch {}
    const btn = document.getElementById('guild-join-btn');
    if (btn) btn.textContent = obj[name] ? '탈퇴' : '가입';
    showToast(obj[name] ? `문파 [${name}]에 가입했소.` : `문파 [${name}]에서 탈퇴했소.`, 'success');
    try {
        if (state.user) {
            if (obj[name]) {
                await client.from('guild_memberships').insert({ user_id: state.user.id, stock_id: name });
            } else {
                await client.from('guild_memberships').delete().match({ user_id: state.user.id, stock_id: name });
            }
        }
    } catch {}
}

function currentMonthKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}
function getLocalPredictions(month) {
    try {
        const raw = localStorage.getItem(`predictions_${month}`);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}
function saveLocalPrediction(month, rec) {
    const list = getLocalPredictions(month);
    list.push(rec);
    try { localStorage.setItem(`predictions_${month}`, JSON.stringify(list)); } catch {}
}
window.submitPrediction = async function() {
    runLocked('submitPrediction', async () => {
        const stockInput = document.getElementById('prediction-stock');
        const name = (stockInput?.value || '').trim();
        const dir = (document.querySelector('input[name="prediction-dir"]:checked')?.value) || 'up';
        if (!name) return showToast('종목을 선택하시오.', 'error');
        const rec = { user_id: state.user?.id || null, stock_id: name, direction: dir, created_at: new Date().toISOString() };
        let ok = false;
        try {
            const { error } = await client.from('predictions').insert(rec);
            ok = !error;
        } catch { ok = false; }
        if (!ok) {
            saveLocalPrediction(currentMonthKey(), rec);
        }
        showToast('예측에 참여했소.', 'success');
        renderPredictionLeaderboard();
    });
}
async function renderPredictionLeaderboard() {
    const container = document.getElementById('prediction-leaderboard');
    if (!container) return;
    container.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">집계 중...</div>';
    const month = currentMonthKey();
    let list = [];
    try {
        const { data, error } = await client.from('predictions_monthly')
            .select('*')
            .eq('month', month);
        const rows = error ? [] : (data || []);
        list = rows.map(r => ({
            name: r.stock_id,
            total: (r.up || 0) + (r.down || 0),
            score: (r.up || 0) - (r.down || 0),
            up: r.up || 0,
            down: r.down || 0
        })).sort((a, b) => b.score - a.score || b.total - a.total).slice(0, 10);
    } catch {
        const rows = getLocalPredictions(month);
        const agg = {};
        rows.forEach(r => {
            const k = r.stock_id;
            if (!agg[k]) agg[k] = { up: 0, down: 0 };
            agg[k][r.direction === 'down' ? 'down' : 'up']++;
        });
        list = Object.entries(agg).map(([name, v]) => {
            const total = v.up + v.down;
            const score = v.up - v.down;
            return { name, total, score, up: v.up, down: v.down };
        }).sort((a, b) => b.score - a.score || b.total - a.total).slice(0, 10);
    }
    container.innerHTML = '';
    list.forEach((it, idx) => {
        const el = document.createElement('div');
        el.className = 'p-3 rounded-xl border border-gray-800 bg-[#1C1C1E] flex items-center justify-between';
        el.innerHTML = `<div class="flex items-center gap-2"><span class="text-xs text-gray-500">${idx + 1}</span><span class="text-sm text-white font-bold">${it.name}</span></div><div class="text-xs"><span class="text-green-400 mr-2">상 ${it.up}</span><span class="text-red-400">하 ${it.down}</span></div>`;
        container.appendChild(el);
    });
    if (!container.childElementCount) container.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">참여 내역이 없소.</div>';
}

window.switchGuildRankingTab = function(type) {
    const postsBtn = document.getElementById('btn-rank-by-posts');
    const membersBtn = document.getElementById('btn-rank-by-members');
    const postsList = document.getElementById('guild-ranking-list');
    const membersList = document.getElementById('guild-member-ranking-list');
    if (!postsBtn || !membersBtn || !postsList || !membersList) return;
    if (type === 'members') {
        membersBtn.classList.add('border-yellow-600','text-yellow-400');
        postsBtn.classList.remove('border-yellow-600','text-yellow-400');
        membersList.classList.remove('hidden');
        postsList.classList.add('hidden');
    } else {
        postsBtn.classList.add('border-yellow-600','text-yellow-400');
        membersBtn.classList.remove('border-yellow-600','text-yellow-400');
        postsList.classList.remove('hidden');
        membersList.classList.add('hidden');
    }
}

window.updateProxySetting = function() {
    const input = document.getElementById('proxy-url-input');
    const url = (input?.value || '').trim();
    try {
        if (url) {
            localStorage.setItem('link_preview_proxy', url);
            window.LINK_PREVIEW_PROXY = url;
            showToast('프록시를 기록했소.', 'success');
        } else {
            localStorage.removeItem('link_preview_proxy');
            window.LINK_PREVIEW_PROXY = null;
            showToast('프록시를 제거했소.', 'success');
        }
    } catch {
        showToast('프록시 기록에 실패했소.', 'error');
    }
}
window.toggleLike = async function() {
    if (!state.user) return showToast('명성(좋아요) 표시는 입문 후 가능하오.', 'error');
    if (state.postToEdit.type === 'secret') return;
    runLocked('toggleLike', async () => {
        const isLiked = state.likedPostIds.has(state.currentPostId);
        const newLikeCount = (state.postToEdit.like_count || 0) + (isLiked ? -1 : 1);
        document.getElementById('detail-likes').innerText = newLikeCount;
        state.postToEdit.like_count = newLikeCount;
        if (isLiked) state.likedPostIds.delete(state.currentPostId);
        else state.likedPostIds.add(state.currentPostId);
        let error;
        if (isLiked) {
            ({ error } = await client.from('post_likes').delete().eq('post_id', state.currentPostId).eq('user_id', state.user.id));
        } else {
            ({ error } = await client.from('post_likes').insert({ post_id: state.currentPostId, user_id: state.user.id }));
        }
        if (error) {
            showToast('처리에 차질이 생겼소.', 'error');
        }
    });
}

window.openPostEditModal = function(post) {
    closeModal('postDetailModal');
    state.isEditing = true;
    state.currentPostId = post.id;
    state.postToEdit = post;
    
    document.getElementById('post-modal-title').innerText = '비급 수련(수정)';
    document.getElementById('save-post-btn').innerText = '수련(수정) 완료';

    document.getElementById(`type-${post.type}`).checked = true;
    togglePostTypeFields(post.type);
    document.getElementById('new-post-title').value = post.title;
    document.getElementById('new-post-content').innerHTML = post.content;
    
    if (post.type === 'stock') document.getElementById('stock-input').value = post.stock_id;
    if (post.type === 'public') document.getElementById('mu-gong-select').value = post.mugong_id;
    if (post.type === 'stock') {
        const sel = document.getElementById('post-category-select');
        if (sel) sel.value = post.category || '';
    }

    openModal('newPostModal');
}

// ------------------------------------------------------------------
// 7. 댓글 및 대댓글
// ------------------------------------------------------------------

async function loadComments(postId) {
    const { data } = await client.from('comments')
        .select(`*, profiles:user_id (nickname, post_count, comment_count)`)
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
    
    const comments = data || [];
    const rootComments = comments.filter(c => !c.parent_id);
    const childComments = comments.filter(c => c.parent_id);
    
    renderComments(rootComments, childComments);
    setupRealtimeComments(postId);
}

function renderComments(roots, children) {
    const list = document.getElementById('comments-list');
    list.innerHTML = '';
    
    const fragment = document.createDocumentFragment();
    roots.forEach(comment => {
        fragment.appendChild(createCommentNode(comment, children));
    });
    list.appendChild(fragment);
}

function getGuestDeviceId() {
    let id = localStorage.getItem('guest_device_id');
    if (!id) {
        id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('g-' + Math.random().toString(36).slice(2));
        localStorage.setItem('guest_device_id', id);
    }
    return id;
}

function createCommentNode(comment, allChildren, depth = 0) {
    const author = comment.profiles?.nickname || comment.guest_nickname || '익명 무협객';
    const level = comment.profiles ? calculateLevel(comment.profiles.post_count, comment.profiles.comment_count) : { name: '입문자', color: 'text-gray-500' };
    const margin = depth * 20;

    const wrapper = document.createElement('div');
    wrapper.className = 'mb-2';
    
    const commentEl = document.createElement('div');
    commentEl.className = `p-2 rounded-lg ${depth > 0 ? 'bg-gray-800/50 border-l-2 border-gray-600' : 'bg-gray-700/50'} relative`;
    commentEl.style.marginLeft = `${margin}px`;
    commentEl.id = `comment-${comment.id}`;
    const deviceId = getGuestDeviceId();
    const canDelete = (state.profile?.role === 'admin') || (state.user && state.user.id === comment.user_id) || (!comment.user_id && comment.guest_device_id && comment.guest_device_id === deviceId);
    
    commentEl.innerHTML = `
        <p class="text-[10px] text-gray-400 mb-1 flex justify-between">
            <span>
                <span class="${level.color}">${level.name}</span>
                <span class="text-yellow-300 font-medium">${author}</span>
            </span>
            <span>${new Date(comment.created_at).toLocaleTimeString()}</span>
        </p>
        <p class="text-xs text-gray-200">${linkifyHtml(comment.content)}</p>
        <div class="flex items-center gap-2 mt-1">
            <button onclick="setReplyTarget('${comment.id}', '${author}')" class="text-[10px] text-gray-500 hover:text-gray-300">↪ 답글</button>
            <button onclick="openInlineReply('${comment.id}', '${author}')" class="text-[10px] text-gray-500 hover:text-gray-300">✎ 인라인</button>
            ${canDelete ? `<button onclick="deleteComment('${comment.id}','${comment.user_id || ''}')" class="text-[10px] text-red-500 hover:text-red-400">파기</button>` : ''}
        </div>
    `;
    wrapper.appendChild(commentEl);

    const replies = allChildren.filter(c => c.parent_id === comment.id);
    if (replies.length > 0) {
        const toggleBar = document.createElement('div');
        toggleBar.style.marginLeft = `${margin}px`;
        const btn = document.createElement('button');
        btn.id = `toggle-replies-btn-${comment.id}`;
        btn.className = 'text-[10px] text-gray-500 hover:text-gray-300 mt-1';
        btn.innerText = `↳ 답글 ${replies.length}개 보기`;
        btn.onclick = () => toggleReplies(comment.id);
        toggleBar.appendChild(btn);
        wrapper.appendChild(toggleBar);
    }
    const repliesBox = document.createElement('div');
    repliesBox.id = `replies-${comment.id}`;
    repliesBox.className = 'mt-1 hidden';
    repliesBox.style.marginLeft = `${margin + 20}px`;
    replies.forEach(reply => {
        repliesBox.appendChild(createCommentNode(reply, allChildren, depth + 1));
    });
    wrapper.appendChild(repliesBox);

    return wrapper;
}
function scrollToComment(domId) {
    let tries = 0;
    const maxTries = 30;
    const tick = setInterval(() => {
        const el = document.getElementById(domId);
        tries++;
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('ring-2','ring-yellow-500');
            setTimeout(() => { el.classList.remove('ring-2','ring-yellow-500'); }, 2000);
            clearInterval(tick);
        } else if (tries >= maxTries) {
            clearInterval(tick);
        }
    }, 100);
}

window.setReplyTarget = function(commentId, authorName) {
    state.replyToCommentId = commentId;
    const input = document.getElementById('comment-input');
    input.placeholder = `@${authorName} 대협에게 답신 작성 중...`;
    input.classList.add('pl-8');
    input.focus();
    
    let cancelBtn = document.getElementById('cancel-reply-btn');
    if(!cancelBtn) {
        cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancel-reply-btn';
        cancelBtn.innerText = '✕';
        cancelBtn.className = 'absolute left-2 top-1/2 -translate-y-1/2 text-red-400 text-xs font-bold';
        cancelBtn.onclick = () => {
            state.replyToCommentId = null;
            input.placeholder = '전서(댓글)를 남기시오...';
            input.classList.remove('pl-8');
            cancelBtn.remove();
        };
        input.parentNode.appendChild(cancelBtn);
    }
}
window.toggleReplies = function(commentId) {
    const box = document.getElementById(`replies-${commentId}`);
    const btn = document.getElementById(`toggle-replies-btn-${commentId}`);
    if (!box || !btn) return;
    const isHidden = box.classList.contains('hidden');
    if (isHidden) {
        box.classList.remove('hidden');
        btn.innerText = btn.innerText.replace('보기', '접기');
    } else {
        box.classList.add('hidden');
        btn.innerText = btn.innerText.replace('접기', '보기');
    }
}
window.openInlineReply = function(commentId, authorName) {
    const existing = document.getElementById(`inline-reply-${commentId}`);
    if (existing) {
        const inp = document.getElementById(`inline-reply-input-${commentId}`);
        if (inp) inp.focus();
        return;
    }
    const parent = document.getElementById(`comment-${commentId}`);
    if (!parent) return;
    const box = document.createElement('div');
    box.id = `inline-reply-${commentId}`;
    box.className = 'mt-2 flex items-center gap-2 relative';
    const input = document.createElement('input');
    input.id = `inline-reply-input-${commentId}`;
    input.type = 'text';
    input.className = 'flex-grow bg-black border border-gray-700 rounded-xl px-3 py-2 text-white focus:border-yellow-500 outline-none text-xs';
    input.placeholder = `@${authorName}에게 답신...`;
    const send = document.createElement('button');
    send.className = 'bg-yellow-600 text-black font-bold px-3 py-2 rounded-xl text-xs hover:bg-yellow-500';
    send.innerText = '올리기';
    send.onclick = () => submitInlineReply(commentId);
    const cancel = document.createElement('button');
    cancel.className = 'bg-gray-800 text-white px-3 py-2 rounded-xl text-xs hover:bg-gray-700 border border-gray-600';
    cancel.innerText = '그만두기';
    cancel.onclick = () => { box.remove(); };
    box.appendChild(input);
    box.appendChild(send);
    box.appendChild(cancel);
    parent.parentNode.insertBefore(box, parent.nextSibling);
    input.focus();
}
async function submitInlineReply(parentId) {
    return runLocked(`inlineReply_${parentId}`, async () => {
        const inp = document.getElementById(`inline-reply-input-${parentId}`);
        if (!inp) return;
        const content = inp.value.trim();
        if (!content) return;
        if (containsBadWords(content)) { showToast('금칙어가 포함되었소.', 'error'); return; }
        if (state.user && state.profile?.is_banned) { showToast('관문 출입 금지 상태이오.', 'error'); return; }
        if (!state.user) {
            const today = new Date().toISOString().split('T')[0];
            const count = parseInt(localStorage.getItem(`comment_count_${today}`) || '0');
            if (count >= 10) { showToast('하루에 10개의 익명 전서만 띄울 수 있소.', 'error'); return; }
        }
        const payload = {
            post_id: state.currentPostId,
            content,
            user_id: (state.user?.id && state.profile?.id === state.user.id) ? state.user.id : null,
            guest_nickname: state.user ? null : `무협객(${Math.floor(Math.random()*1000)})`,
            guest_device_id: state.user ? null : getGuestDeviceId(),
            parent_id: parentId
        };
        const { error } = await client.from('comments').insert(payload);
        if (error) {
            try { console.warn('인라인 답글 등록 오류:', error); } catch {}
            const m = (error.message || '').toLowerCase();
            if (m.includes('row level security') || m.includes('with check')) {
                showToast('전서 제한에 걸렸소. 잠시 후 다시 시도하오.', 'error');
                logRateLimit('comment_insert', error.message || 'rls');
            } else {
                showToast(`전서 등록에 차질이 생겼소: ${error.message || '알 수 없는 오류'}`, 'error');
            }
            return;
        }
        const box = document.getElementById(`inline-reply-${parentId}`);
        if (box) box.remove();
        await loadComments(state.currentPostId);
        const domId = `comment-${parentId}`;
        scrollToComment(domId);
    });
}

async function addComment() {
    return runLocked('addComment', async () => {
        const postId = state.currentPostId;
        const input = document.querySelector('#post-detail:not(.hidden) #comment-input') 
            || document.getElementById('comment-input') 
            || document.getElementById('comment-input-modal');
        const content = input.value.trim();
        if (!content || !postId) return;
        if (containsBadWords(content)) return showToast('금칙어가 포함되었소.', 'error');
        if (state.profile?.is_banned) return showToast('관문 출입 금지 상태이오.', 'error');
        if (!requireAuth('전서 남기기')) return;

        const payload = {
            post_id: postId,
            content: content,
            user_id: state.user.id,
            guest_nickname: null,
            guest_device_id: null,
            parent_id: state.replyToCommentId || null
        };

    const { error } = await client.from('comments').insert(payload);
    if (error) {
        try { console.warn('댓글 등록 오류:', error); } catch {}
        const m = (error.message || '').toLowerCase();
        if (m.includes('row level security') || m.includes('with check')) {
            showToast('전서 제한에 걸렸소. 잠시 후 다시 시도하오.', 'error');
            logRateLimit('comment_insert', error.message || 'rls');
        } else {
            showToast(`전서 등록에 차질이 생겼소: ${error.message || '알 수 없는 오류'}`, 'error');
        }
        return;
    } else {
            input.value = '';
            
            state.replyToCommentId = null;
            input.placeholder = '전서(댓글)를 남기시오...';
            const cancelBtn = document.getElementById('cancel-reply-btn');
            if(cancelBtn) cancelBtn.remove();
            input.classList.remove('pl-8');
            await loadComments(postId);
        }
    });
}

window.deleteComment = async function(commentId, userId) {
    const isAdmin = state.profile?.role === 'admin';
    const isAuthor = state.user && (state.user.id === userId);
    if (isAdmin || isAuthor) {
        const { error } = await client.from('comments').delete().eq('id', commentId);
        if (error) showToast('파기 중 문제가 생겼소.', 'error');
        else {
            showToast('전서를 파기했소.', 'success');
            if (state.currentPostId) await loadComments(state.currentPostId);
        }
        return;
    }
    const deviceId = getGuestDeviceId();
    const { error } = await client.rpc('delete_guest_comment', { p_comment_id: commentId, p_device_id: deviceId });
    if (error) showToast('파기 중 문제가 생겼소.', 'error');
    else {
        showToast('전서를 파기했소.', 'success');
        if (state.currentPostId) await loadComments(state.currentPostId);
    }
}

function setupRealtimeComments(postId) {
    const channelKey = `comments_${postId}`;
    ensureChannel(channelKey, () =>
        client.channel(channelKey)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` }, 
                () => loadComments(postId)
            ).subscribe()
    );
}

// ------------------------------------------------------------------
// 8. 채팅
// ------------------------------------------------------------------

async function loadChat() {
    const { data } = await client.from('chat_messages').select(`*, profiles:user_id (nickname)`).order('created_at', { ascending: false }).limit(50);
    renderChat(data.reverse() || []);
    setupRealtimeChat();
}

function renderChat(messages) {
    const chatList = document.getElementById('chat-list');
    chatList.innerHTML = '';
    const fragment = document.createDocumentFragment();
    messages.forEach(msg => {
    const author = msg.profiles?.nickname || msg.guest_nickname || '익명 무협객';
        const msgEl = document.createElement('div');
        msgEl.className = 'text-xs mb-1';
        msgEl.innerHTML = `<span class="text-yellow-400 font-medium">${author}:</span> <span class="text-gray-300">${linkifyHtml(msg.content)}</span>`;
        fragment.appendChild(msgEl);
    });
    chatList.appendChild(fragment);
    chatList.scrollTop = chatList.scrollHeight;
}

async function sendChat() {
    runLocked('sendChat', async () => {
        const input = document.getElementById('chat-input');
        const content = input.value.trim();
        if (!content) return;
        const payload = { content: content, user_id: state.user?.id || null, guest_nickname: state.user ? null : state.guestName };
        const { error } = await client.from('chat_messages').insert(payload);
        if (!error) input.value = '';
    });
}

function setupRealtimeChat() {
    ensureChannel('chat', () =>
        client.channel('chat')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => loadChat())
            .subscribe()
    );
}

// ------------------------------------------------------------------
// 8. 쪽지 (Messages)
// ------------------------------------------------------------------

async function fetchMessages() {
    if (!state.user) return [];
    
    const { data, error } = await client.from('messages')
        .select(`*, profiles:sender_id (nickname)`)
        .eq('receiver_id', state.user.id)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('쪽지 불러오기 실패:', error);
        return [];
    }
    return data || [];
}

async function checkUnreadMessages() {
    if (!state.user) return;
    
    const { count, error } = await client.from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('receiver_id', state.user.id)
        .eq('is_read', false);

    if (!error) {
        const badge = document.getElementById('msg-badge');
        if (!badge) return;
        if (count > 0) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    }
}

window.openMessageModal = async function() {
    if (!state.user) {
        showToast('입문이 필요하오.', 'error');
        openModal('authModal');
        return;
    }

    const modal = document.getElementById('messageModal');
    modal.classList.remove('hidden');
    document.getElementById('message-compose-area').classList.add('hidden');
    document.getElementById('message-list').classList.remove('hidden');
    
    await loadMessageList();
}

async function loadMessageList() {
    const list = document.getElementById('message-list');
    list.innerHTML = '<div class="text-center text-gray-500 mt-4">전갈을 불러오는 중...</div>';
    
    const messages = await fetchMessages();
    list.innerHTML = '';
    
    if (messages.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-500 mt-10">받은 밀서가 없소.</div>';
        return;
    }
    
    const fragment = document.createDocumentFragment();
    messages.forEach(msg => {
        const el = document.createElement('div');
        el.className = `p-3 rounded-xl cursor-pointer hover:bg-gray-800 transition ${msg.is_read ? 'bg-transparent' : 'bg-gray-800/30 border border-yellow-900/30'}`;
        el.onclick = () => viewMessage(msg);
        
        const sender = msg.profiles?.nickname || '알 수 없음';
        const date = new Date(msg.created_at).toLocaleDateString();
        
        el.innerHTML = `
            <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-sm ${msg.is_read ? 'text-gray-400' : 'text-yellow-400'}">${sender}</span>
                <span class="text-xs text-gray-500">${date}</span>
            </div>
            <p class="text-sm text-gray-300 truncate">${linkifyHtml(msg.content)}</p>
        `;
        fragment.appendChild(el);
    });
    list.appendChild(fragment);
    
    // 읽음 처리 후 배지 업데이트
    checkUnreadMessages();
}

window.viewMessage = async function(msg) {
    // 상세 보기 (간단하게 리스트 내에서 확장하거나 모달을 바꿀 수 있음. 여기선 리스트 대신 내용을 보여주는 방식으로 구현)
    const list = document.getElementById('message-list');
    
    // 읽음 처리
    if (!msg.is_read) {
        await client.from('messages').update({ is_read: true }).eq('id', msg.id);
        checkUnreadMessages();
    }
    
    const sender = msg.profiles?.nickname || '알 수 없음';
    
    list.innerHTML = `
        <div class="flex flex-col h-full">
            <button onclick="loadMessageList()" class="text-left text-gray-400 text-sm mb-4 hover:text-white">← 목록으로</button>
            <div class="bg-[#2C2C2E] p-4 rounded-xl mb-4">
                <div class="flex justify-between items-center mb-3 border-b border-gray-700 pb-2">
                    <span class="font-bold text-white">${sender}</span>
                    <span class="text-xs text-gray-500">${new Date(msg.created_at).toLocaleString()}</span>
                </div>
                <div class="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">${linkifyHtml(msg.content)}</div>
            </div>
            <button onclick="openMessageCompose('${msg.sender_id}', '${sender}')" class="self-end bg-yellow-600 text-black font-bold px-4 py-2 rounded-lg text-sm hover:bg-yellow-500">답장하기</button>
        </div>
    `;
}

window.openMessageCompose = function(receiverId, receiverName) {
    if (!state.user) {
        showToast('입문이 필요하오.', 'error');
        return;
    }
    
    // 모달이 닫혀있으면 염
    const modal = document.getElementById('messageModal');
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
    }
    
    document.getElementById('message-list').classList.add('hidden');
    const composeArea = document.getElementById('message-compose-area');
    composeArea.classList.remove('hidden');
    
    document.getElementById('msg-receiver-name').innerText = receiverName;
    document.getElementById('msg-receiver-name').dataset.id = receiverId;
    document.getElementById('msg-content').value = '';
    document.getElementById('msg-content').focus();
}

window.cancelMessage = function() {
    document.getElementById('message-compose-area').classList.add('hidden');
    document.getElementById('message-list').classList.remove('hidden');
    loadMessageList();
}

window.submitMessage = async function() {
    runLocked('submitMessage', async () => {
        const receiverId = document.getElementById('msg-receiver-name').dataset.id;
        const content = document.getElementById('msg-content').value.trim();
        if (!content) {
            showToast('내용을 채우시오.', 'error');
            return;
        }
        const { error } = await client.from('messages').insert({
            sender_id: state.user.id,
            receiver_id: receiverId,
            content: content
        });
        if (error) {
            showToast('발송 불발: ' + error.message, 'error');
        } else {
            showToast('밀서를 보냈소.', 'success');
            cancelMessage();
        }
    });
}

// ------------------------------------------------------------------
// 9. 초기화 및 이벤트 리스너
// ------------------------------------------------------------------

function resetPostStateAndUI() {
    state.isEditing = false;
    state.postToEdit = null;
    state.currentPostId = null; 
    document.getElementById('post-modal-title').innerText = '비급 집필';
    
    const saveBtn = document.getElementById('save-post-btn');
    if(saveBtn) saveBtn.innerText = '게시';

    document.getElementById('new-post-title').value = '';
    document.getElementById('new-post-content').innerHTML = '';
    document.querySelectorAll('input[name="post-type"]').forEach(radio => { radio.disabled = false; radio.checked = false; });
    document.getElementById('type-public').checked = true;
    togglePostTypeFields('public');

    const previewArea = document.getElementById('preview-mode-area');
    if(previewArea) previewArea.classList.add('hidden');
    const previewBtn = document.getElementById('preview-btn');
    if(previewBtn) previewBtn.innerText = '미리보기';
    const toolbar = document.querySelector('.editor-toolbar');
    if(toolbar) toolbar.classList.remove('hidden');
}

window.openLegalModal = function(tab) {
    openModal('legalModal');
    switchLegalTab(tab);
}

window.switchLegalTab = function(tab) {
    const title = document.getElementById('legal-title');
    const content = document.getElementById('legal-content');
    
    if (tab === 'terms') {
        title.innerText = '문파 규율 (Terms of Service)';
        content.innerHTML = `
            <h4 class="font-bold mb-2">제1조 (목적)</h4>
            <p class="mb-2">본 규율은 천금문(이하 '본 문파')이 제공하는 비급 공유의 이용조건 및 절차, 협객과 문파의 권리, 의무, 책임사항을 규정함을 목적으로 하오.</p>
            <h4 class="font-bold mb-2">제2조 (면책)</h4>
            <p class="mb-2">본 문파에서 제공되는 비급(정보)은 참고용일 뿐이며, 내공 수련(투자)의 책임은 전적으로 협객 본인에게 있소.</p>
            <p>더 상세한 내용은 실제 운영 시 법률 전문가의 자문을 받아 작성해야 하오.</p>
        `;
    } else {
        title.innerText = '신상 정보 처리 방침 (Privacy Policy)';
        content.innerHTML = `
            <h4 class="font-bold mb-2">1. 수집하는 신상 정보</h4>
            <p class="mb-2">서신 주소(이메일), 접속 기록, 쿠키, 호(닉네임) 등.</p>
            <h4 class="font-bold mb-2">2. 신상 정보의 보관 및 이용기간</h4>
            <p class="mb-2">협객은 하산(탈퇴) 시까지 정보를 보유하며, 강호의 법도(법령)에 따른 보존 기간 동안은 보관되오.</p>
        `;
    }
}

function init() {
    // 헤더/네비 즉시 표시 (직접 접속 시 UI 보장)
    const headerEl = document.querySelector('header');
    const navEl = document.querySelector('nav');
    if (headerEl) headerEl.classList.remove('hidden');
    if (navEl) navEl.classList.remove('hidden');
    try {
        const titleEl = document.getElementById('brand-title');
        if (titleEl) {
            const supportsWebkit = CSS && CSS.supports && CSS.supports('-webkit-background-clip', 'text');
            const supportsStandard = CSS && CSS.supports && CSS.supports('background-clip', 'text');
            if (supportsWebkit || supportsStandard) {
                titleEl.classList.add('gradient-text');
            }
        }
    } catch {}
    setupBackToTop();
    applyAccessibilitySettings();

    const mugongSel = document.getElementById('mu-gong-select');
    MU_GONG_TYPES.forEach(m => mugongSel.innerHTML += `<option value="${m.id}">${m.name}</option>`);
    checkSession();
    fetchStockTags();
    window.onpopstate = () => {
        const hash = window.location.hash.replace('#', '');
        
        // 뒤로가기 시 열려있는 모달들 닫기
        ['postDetailModal', 'newPostModal', 'notificationModal', 'messageModal', 'userActionSheet', 'profileViewModal'].forEach(id => {
            const m = document.getElementById(id);
            if (m && !m.classList.contains('hidden')) {
                // postDetailModal은 아래 로직에서 처리되거나, 여기서 닫음
                if (id !== 'postDetailModal') closeModal(id);
            }
        });

        if (hash) {
            if (hash.startsWith('post-')) {
                const postId = hash.substring(5);
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(postId)) {
                    navigate('gangho-plaza', false);
                    return;
                }
                client.from('posts')
                    .select(`*, profiles:user_id (nickname, post_count, comment_count, avatar_url)`)
                    .eq('id', postId)
                    .single()
                    .then(({ data }) => {
                        if (data) {
                            openPostDetail(data);
                        } else {
                            closeModal('postDetailModal');
                        }
                    });
            } else {
                // 포스트 모달이 열려있다면 닫기 (URL이 포스트가 아니므로)
                const pm = document.getElementById('postDetailModal');
                if (pm && !pm.classList.contains('hidden')) {
                    pm.classList.add('hidden');
                    state.currentPostId = null;
                }
                navigate(hash, false);
            }
        } else {
            // 포스트 모달 닫기
            const pm = document.getElementById('postDetailModal');
            if (pm && !pm.classList.contains('hidden')) {
                pm.classList.add('hidden');
                state.currentPostId = null;
            }
            navigate('gangho-plaza', false);
        }
    };

    const initialHash = window.location.hash.replace('#', '');
    if (initialHash) {
        if (initialHash.startsWith('post-')) {
            const postId = initialHash.substring(5);
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(postId)) {
                navigate('gangho-plaza', false);
                return;
            }
            client.from('posts')
                .select(`*, profiles:user_id (nickname, post_count, comment_count, avatar_url)`)
                .eq('id', postId)
                .single()
                .then(({ data }) => {
                    if (data) openPostDetail(data);
                    else navigate('gangho-plaza', false);
                });
        } else if (document.getElementById(initialHash)) {
            navigate(initialHash, false);
        } else {
            navigate('gangho-plaza', false);
        }
    } else {
        navigate('gangho-plaza', false);
    }
    
    window.onclick = function(event) {
        const t = event.target;
        if (t.classList.contains('fixed') && typeof t.id === 'string' && t.id.endsWith('Modal')) {
            // notificationModal은 자동닫기 로직이 있으므로 클릭 닫기 제외하거나, 포함해도 됨.
            // 여기서는 모든 모달 배경 클릭 시 닫기
            t.classList.add('hidden');
            if (t.id === 'postDetailModal') {
                state.currentPostId = null;
                const url = new URL(window.location);
                if (url.hash.startsWith('#post-')) {
                    history.pushState(null, '', window.location.pathname);
                }
            }
        }
    }
    
    window.onkeydown = function(e) {
        if (e.key === 'Escape') {
            const modals = document.querySelectorAll('[id$="Modal"]');
            let closedAny = false;
            modals.forEach(m => {
                if (!m.classList.contains('hidden')) {
                    m.classList.add('hidden');
                    closedAny = true;
                    if (m.id === 'postDetailModal') {
                        state.currentPostId = null;
                        const url = new URL(window.location);
                        if (url.hash.startsWith('#post-')) {
                            history.pushState(null, '', window.location.pathname);
                        }
                    }
                }
            });
            const sheet = document.getElementById('userActionSheet');
            if (sheet && !sheet.classList.contains('hidden')) {
                sheet.classList.add('hidden');
                closedAny = true;
            }
        }
        if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
            e.preventDefault();
            openMenuPalette();
        }
    }
    
    attachRealtimeDiagnostics();
    setupGlobalRealtime();
    setupDraggableFab();
    setupEditorSelectionTracking();
    renderMegaMenu();
    renderRecentMenuBar();
}
window.applyAccessibilitySettings = function() {
    try {
        const large = JSON.parse(localStorage.getItem('access_large') || 'false');
        const contrast = JSON.parse(localStorage.getItem('access_contrast') || 'false');
        const reading = JSON.parse(localStorage.getItem('reading_mode') || 'false');
        document.body.classList.toggle('access-large', !!large);
        document.body.classList.toggle('contrast-high', !!contrast);
        document.body.classList.toggle('reading-mode', !!reading);
    } catch {}
};
window.toggleLargeText = function() {
    const on = document.body.classList.toggle('access-large');
    try { localStorage.setItem('access_large', JSON.stringify(on)); } catch {}
    showToast(on ? '큰 글씨 모드를 켰소.' : '큰 글씨 모드를 껐소.', 'success');
};
window.toggleHighContrast = function() {
    const on = document.body.classList.toggle('contrast-high');
    try { localStorage.setItem('access_contrast', JSON.stringify(on)); } catch {}
    showToast(on ? '고대비 모드를 켰소.' : '고대비 모드를 껐소.', 'success');
};
window.toggleRecoIncludeSecret = function(on) {
    state.includeSecretInReco = !!on;
    try { localStorage.setItem('reco_include_secret', JSON.stringify(!!on)); } catch {}
    if (document.getElementById('gangho-plaza') && !document.getElementById('gangho-plaza').classList.contains('hidden')) {
        loadRecommended();
    }
};
window.toggleReadingMode = function() {
    const on = document.body.classList.toggle('reading-mode');
    try { localStorage.setItem('reading_mode', JSON.stringify(on)); } catch {}
    showToast(on ? '읽기 모드를 켰소.' : '읽기 모드를 껐소.', 'success');
};

// ------------------------------------------------------------------
// 10. 글로벌 실시간 (Posts, Messages, StockTags)
// ------------------------------------------------------------------

function ensureChannel(name, builder) {
    try {
        if (state.realtimeChannels[name]) client.removeChannel(state.realtimeChannels[name]);
        const ch = builder();
        ch.on('status', (s) => {
            if (s === 'TIMED_OUT' || s === 'CHANNEL_ERROR') {
                setTimeout(() => ensureChannel(name, builder), 3000);
            }
        });
        state.realtimeChannels[name] = ch;
        return ch;
    } catch (e) {
        console.error('채널 생성 실패:', name, e);
        return null;
    }
}

function attachRealtimeDiagnostics() {
    try {
        client.realtime.onOpen(() => console.log('Realtime 연결 열림'));
        client.realtime.onClose(() => console.warn('Realtime 연결 종료'));
        client.realtime.onError((e) => {
            console.error('Realtime 오류:', e);
            showToast('실시간 연결에 문제가 있소. 잠시 후 재시도하오.', 'error');
        });
    } catch (e) {}
}

function setupGlobalRealtime() {
    setupRealtimePostsForView();

    // 2. Stock Tags (새로운 종목 추가)
    ensureChannel('global_stocks', () =>
        client.channel('public:stock_tags')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stock_tags' }, payload => {
                state.stockTags.push(payload.new.name);
                renderStockTabs();
                renderStockOptions();
                showToast(`📈 새로운 종목 [${payload.new.name}]이(가) 등재되었소!`, 'info');
            })
            .subscribe()
    );
}
function setupRealtimePostsForView() {
    const view = getCurrentViewType();
    ['rt_posts_public','rt_posts_secret','rt_posts_stock'].forEach(k => {
        if (state.realtimeChannels[k]) {
            client.removeChannel(state.realtimeChannels[k]);
            delete state.realtimeChannels[k];
        }
    });
    if (view === 'public') {
        ensureChannel('rt_posts_public', () =>
            client.channel('public:posts')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts', filter: 'type=eq.public' }, payload => {
                    handleNewPostRealtime(payload.new);
                })
                .subscribe()
        );
        if (state.includeSecretInPlaza) {
            ensureChannel('rt_posts_secret', () =>
                client.channel('public:posts')
                    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts', filter: 'type=eq.secret' }, payload => {
                        handleNewPostRealtime(payload.new);
                    })
                    .subscribe()
            );
        }
    } else if (view === 'secret') {
        ensureChannel('rt_posts_secret', () =>
            client.channel('public:posts')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts', filter: 'type=eq.secret' }, payload => {
                    handleNewPostRealtime(payload.new);
                })
                .subscribe()
        );
    } else if (view === 'stock') {
        const filter = state.currentStockName ? `type=eq.stock&stock_id=eq.${state.currentStockName}` : 'type=eq.stock';
        ensureChannel('rt_posts_stock', () =>
            client.channel('public:posts')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts', filter }, payload => {
                    handleNewPostRealtime(payload.new);
                })
                .subscribe()
        );
    }
}

// ------------------------------------------------------------------
// 에디터 커서 위치 추적 및 HTML 삽입
// ------------------------------------------------------------------
let editorSelectionRange = null;
function setupEditorSelectionTracking() {
    const editor = document.getElementById('new-post-content');
    if (!editor) return;
    const saveRange = () => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            editorSelectionRange = sel.getRangeAt(0);
        }
    };
    ['keyup','mouseup','input','focus'].forEach(ev => editor.addEventListener(ev, saveRange));
    editor.addEventListener('blur', saveRange);
}
window.captureEditorSelection = function() {
    const editor = document.getElementById('new-post-content');
    if (!editor) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (editor.contains(range.startContainer)) {
            editorSelectionRange = range;
        }
    }
};
function insertHtmlAtSelection(html) {
    const editor = document.getElementById('new-post-content');
    if (!editor) return;
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const node = temp.firstElementChild || document.createTextNode(html);
    editor.focus();
    const sel = window.getSelection();
    if (editorSelectionRange) {
        sel.removeAllRanges();
        sel.addRange(editorSelectionRange);
    }
    if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(node);
        // 커서를 삽입한 노드 뒤로 이동
        range.setStartAfter(node);
        range.setEndAfter(node);
        sel.removeAllRanges();
        sel.addRange(range);
    } else {
        editor.appendChild(node);
    }
}
function setupDraggableFab() {
    const btn = document.getElementById('fab-write-btn');
    if (!btn) return;
    const saved = localStorage.getItem('fab_pos');
    if (saved) {
        try {
            const { x, y } = JSON.parse(saved);
            btn.style.left = `${x}px`;
            btn.style.top = `${y}px`;
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
            btn.style.position = 'fixed';
        } catch {}
    } else {
        try {
            const nav = document.querySelector('nav');
            const rect = nav ? nav.getBoundingClientRect() : { height: 56 };
            const w = btn.offsetWidth || 56;
            const h = btn.offsetHeight || 56;
            const margin = 12;
            const x = Math.max(window.innerWidth - w - margin, margin);
            const y = Math.max(window.innerHeight - (rect.height || 56) - h - margin, margin);
            btn.style.left = `${x}px`;
            btn.style.top = `${y}px`;
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
            btn.style.position = 'fixed';
        } catch {}
    }
    const stateFab = { dragging: false, startX: 0, startY: 0, originX: 0, originY: 0, preventClick: false };
    const getClamp = () => {
        const w = btn.offsetWidth || 56;
        const h = btn.offsetHeight || 56;
        const maxX = window.innerWidth - w - 8;
        const maxY = window.innerHeight - h - 8;
        return { maxX, maxY, w, h };
    };
    const onDown = (e) => {
        const p = e.touches ? e.touches[0] : e;
        const rect = btn.getBoundingClientRect();
        stateFab.dragging = true;
        stateFab.startX = p.clientX;
        stateFab.startY = p.clientY;
        stateFab.originX = rect.left;
        stateFab.originY = rect.top;
        stateFab.preventClick = false;
        btn.style.transition = 'none';
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
    };
    const onMove = (e) => {
        if (!stateFab.dragging) return;
        const p = e.touches ? e.touches[0] : e;
        const dx = p.clientX - stateFab.startX;
        const dy = p.clientY - stateFab.startY;
        if (Math.abs(dx) + Math.abs(dy) > 5) stateFab.preventClick = true;
        const { maxX, maxY } = getClamp();
        let nx = Math.min(Math.max(stateFab.originX + dx, 8), maxX);
        let ny = Math.min(Math.max(stateFab.originY + dy, 8), maxY);
        btn.style.left = `${nx}px`;
        btn.style.top = `${ny}px`;
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
        btn.style.position = 'fixed';
        e.preventDefault();
    };
    const onUp = () => {
        if (!stateFab.dragging) return;
        stateFab.dragging = false;
        btn.style.transition = '';
        const rect = btn.getBoundingClientRect();
        const { maxX, maxY } = getClamp();
        const x = Math.min(Math.max(rect.left, 8), maxX);
        const y = Math.min(Math.max(rect.top, 8), maxY);
        localStorage.setItem('fab_pos', JSON.stringify({ x, y }));
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
    };
    btn.addEventListener('pointerdown', onDown);
    btn.addEventListener('touchstart', onDown, { passive: true });
    btn.addEventListener('click', (e) => {
        if (stateFab.preventClick) {
            e.stopPropagation();
            e.preventDefault();
            stateFab.preventClick = false;
        }
    }, true);
}
function setupBackToTop() {
    const btn = document.getElementById('back-to-top-btn');
    if (!btn) return;
    const onScroll = () => {
        const y = window.pageYOffset || document.documentElement.scrollTop || 0;
        btn.classList.toggle('hidden', y < 200);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
}
async function handleNewPostRealtime(newPost) {
    // 현재 보고 있는 뷰 타입 확인
    const currentView = window.getCurrentViewType(); // 'public', 'stock', 'secret'
    
    // 새 글이 현재 뷰와 관련 있는지 확인
    let isRelevant = false;
    let containerId = '';

    if (currentView === 'public' && (newPost.type === 'public' || newPost.type === 'secret')) {
        isRelevant = true;
        containerId = 'posts-list-public';
    } else if (newPost.type === 'stock' && currentView === 'stock') {
        // 종목 탭도 일치해야 함
        if (newPost.stock_id === state.currentStockName) {
            isRelevant = true;
            containerId = 'posts-list-stock';
        }
    } else if (newPost.type === 'secret' && currentView === 'secret') {
        isRelevant = true;
        containerId = 'posts-list-secret';
    }

    if (isRelevant) {
        // 닉네임 등을 가져오기 위해 추가 정보 페치 (JOIN이 안되므로 단건 조회 필요)
        const { data: fullPost } = await client.from('posts')
            .select(`*, profiles:user_id (nickname, post_count, comment_count)`)
            .eq('id', newPost.id)
            .single();
            
        if (fullPost) {
            const container = document.getElementById(containerId);
            // 중복 방지: 이미 동일 ID의 카드가 있으면 추가하지 않음
            if (container.querySelector(`[data-post-id="${fullPost.id}"]`)) return;
            const newEl = createPostElement(fullPost);
            newEl.classList.add('animate-pulse'); // 강조 효과
            
            // 검색 중이 아닐 때만 맨 위에 추가
            if (!state.searchQuery) {
                if (container.firstChild) {
                    container.insertBefore(newEl, container.firstChild);
                } else {
                    container.appendChild(newEl);
                }
                while (container.children.length > 30) {
                    container.removeChild(container.lastChild);
                }
                setTimeout(() => newEl.classList.remove('animate-pulse'), 2000);
            }
        }
    }
    
    // 알림은 뷰와 상관없이 띄울 수도 있지만, 너무 많으면 방해되므로 현재 뷰와 다를 때만 띄우거나 생략
    // 여기서는 "실시간 응답"을 위해 현재 뷰가 아니더라도 중요 알림(예: 내 종목) 등을 띄울 수 있음.
    // 일단은 현재 뷰에 추가되었을 때 토스트
    if (isRelevant) {
        showToast('새로운 비급이 당도했소!', 'success');
    }
}


// 전역 함수 매핑 (HTML 이벤트 핸들러용)
window.openModal = (id) => document.getElementById(id).classList.remove('hidden');
window.closeModal = (id) => {
    document.getElementById(id).classList.add('hidden');
    if (id === 'newPostModal') resetPostStateAndUI();
    if (id === 'postDetailModal') {
        const key = state.currentPostId ? `comments_${state.currentPostId}` : null;
        if (key && state.realtimeChannels[key]) {
            client.removeChannel(state.realtimeChannels[key]);
            delete state.realtimeChannels[key];
        }
        // 히스토리 되돌림: 모바일 뒤로가기 자연스러운 동작
        try {
            if (window.location.hash.startsWith('#post-')) {
                window.history.back();
            }
        } catch (e) {}
        state.currentPostId = null;
    }
};
window.handleAuth = handleAuth;
window.sendPasswordReset = sendPasswordReset;
window.logout = logout;
window.sendChat = sendChat;
window.addComment = addComment;
window.savePost = savePost;
window.formatDoc = (cmd, value = null) => {
    document.execCommand(cmd, false, value);
    document.getElementById('new-post-content').focus();
};
window.getCurrentViewType = function() {
    if (!document.getElementById('gangho-plaza').classList.contains('hidden')) return 'public';
    if (!document.getElementById('stock-board').classList.contains('hidden')) return 'stock';
    if (!document.getElementById('secret-inn').classList.contains('hidden')) return 'secret';
    if (!document.getElementById('journal-board').classList.contains('hidden')) return 'journal';
    if (!document.getElementById('free-board').classList.contains('hidden')) return 'free';
    if (!document.getElementById('humor-board').classList.contains('hidden')) return 'humor';
    if (!document.getElementById('debate-board').classList.contains('hidden')) return 'debate';
    if (!document.getElementById('music-board').classList.contains('hidden')) return 'music';
    if (!document.getElementById('travel-board').classList.contains('hidden')) return 'travel';
    if (!document.getElementById('event-board').classList.contains('hidden')) return 'event';
    if (!document.getElementById('welcome-board').classList.contains('hidden')) return 'welcome';
    return 'public';
};

window.tryOpenWriteModal = (type) => {
    try {
        if (!state.user && type !== 'secret') {
            if(confirm('비급 기록은 입문한 협객만 가능하오. 입문하시겠소?')) openModal('authModal');
            return;
        }

        if (type === 'journal') {
            openModal('newJournalModal');
            return;
        }

        if (['free', 'humor', 'debate', 'music', 'travel', 'event', 'welcome'].includes(type)) {
            // For now, treat these as public posts but maybe we'll need a way to distinguish them in the DB
            // Currently DB only has 'public', 'stock', 'secret'. 
            // We will map them to 'public' and maybe prepend a tag in title or content if needed.
            // But for simplicity, let's just open the public modal.
            // Ideally, we should add a 'category' column to posts table.
            // For now, let's just open the public modal.
            resetPostStateAndUI();
            document.getElementById('type-public').checked = true;
            togglePostTypeFields('public');
            openModal('newPostModal');
            return;
        }
        
        if (type === 'secret' && !state.user) {
            const today = new Date().toISOString().split('T')[0];
            const count = parseInt(localStorage.getItem(`post_count_${today}`) || '0');
            if (count >= 3) {
                showToast('하루에 3개의 익명 비급만 집필할 수 있소.', 'error');
                return;
            }
        }

        resetPostStateAndUI(); 
        const radio = document.getElementById(`type-${type}`);
        if(radio) radio.checked = true;
        
        togglePostTypeFields(type);
        openModal('newPostModal');
        
        if (type === 'stock') {
            const stockInput = document.getElementById('stock-input');
            if(stockInput) stockInput.value = state.currentStockName;
            attachStockAutocomplete();
        }
        
        checkAndLoadTempPost();
        
        setTimeout(() => {
            const editor = document.getElementById('new-post-content');
            if(editor) editor.focus();
        }, 100);
        
    } catch (err) {
        console.error('글쓰기 모달 열기 실패:', err);
        showToast('글쓰기 창을 여는데 문제가 생겼소.', 'error');
    }
};

window.togglePostTypeFields = (type) => {
    document.getElementById('mu-gong-area').classList.toggle('hidden', type !== 'public');
    document.getElementById('stock-area').classList.toggle('hidden', type !== 'stock');
    const cat = document.getElementById('category-area');
    if (cat) cat.classList.toggle('hidden', type !== 'stock');
    document.querySelectorAll('input[name="post-type"]').forEach(radio => radio.disabled = state.isEditing);
};

window.togglePreview = function() {
    const previewArea = document.getElementById('preview-mode-area');
    const btn = document.getElementById('preview-btn');
    const toolbar = document.querySelector('.editor-toolbar');
    
    if (previewArea.classList.contains('hidden')) {
        const title = document.getElementById('new-post-title').value;
        const content = document.getElementById('new-post-content').innerHTML;
        
        if (!title && !content.trim()) return showToast('살펴볼 내용이 없소.', 'error');

        document.getElementById('preview-title-text').innerText = title || '(제목 없음)';
        document.getElementById('preview-body-content').innerHTML = content || '(내용 없음)';
        
        previewArea.classList.remove('hidden');
        btn.innerText = '교정 계속';
        toolbar.classList.add('hidden'); 
    } else {
        previewArea.classList.add('hidden');
        btn.innerText = '초본 보기';
        toolbar.classList.remove('hidden');
    }
};

window.handleYouTubeEmbed = window.openYouTubeModal;

// ------------------------------------------------------------------
// 8. 추가 기능: 좋아요, 신고, 알림 (Extensions)
// ------------------------------------------------------------------

async function fetchMyLikes() {
    if (!state.user) return;
    const { data } = await client.from('post_likes').select('post_id').eq('user_id', state.user.id);
    if (data) {
        state.likedPostIds = new Set(data.map(item => item.post_id));
    } else {
        state.likedPostIds = new Set();
    }
}

let reportTarget = null; // { type: 'post'|'comment', id: string }

window.openReportModal = function(type, id) {
    if (!state.user) return showToast('입문 후 이용 가능하오.', 'error');
    reportTarget = { type, id };
    document.getElementById('report-details').value = '';
    document.getElementById('report-reason').selectedIndex = 0;
    openModal('reportModal');
}

window.submitReport = async function() {
    if (!reportTarget) return;
    const reason = document.getElementById('report-reason').value;
    const details = document.getElementById('report-details').value;
    
    const { error } = await client.from('reports').insert({
        reporter_id: state.user.id,
        target_type: reportTarget.type,
        target_id: reportTarget.id,
        reason: reason + (details ? `: ${details}` : '')
    });

    if (error) {
        showToast('신고 접수 중 문제가 생겼소.', 'error');
    } else {
        showToast('신고가 접수되었소. 방장(운영진)이 살펴볼 것이오.', 'success');
        closeModal('reportModal');
    }
}

window.openNotificationModal = function() {
    if (!state.user) return showToast('입문 후 이용 가능하오.', 'error');
    openModal('notificationModal');
    loadNotifications();
    scheduleNotificationAutoClose();
}

async function loadNotifications() {
    const list = document.getElementById('notification-list');
    list.innerHTML = '<div class="text-center text-gray-500 mt-4 text-xs">전갈을 불러오는 중...</div>';
    
    let query = client.from('notifications')
        .select('*')
        .eq('user_id', state.user.id)
        .order('created_at', { ascending: false })
        .limit(50);
    if (typeof currentNotificationsFilter === 'string' && currentNotificationsFilter !== 'all') {
        query = query.eq('type', currentNotificationsFilter);
    }
    const { data, error } = await query;

    if (error || !data) {
        list.innerHTML = '<div class="text-center text-gray-500 mt-4 text-xs">전갈을 불러올 수 없소.</div>';
        return;
    }

    if (data.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-500 mt-4 text-xs">새로운 전갈이 없소.</div>';
        scheduleNotificationAutoClose();
        return;
    }

    list.innerHTML = data.map(noti => {
        const t = noti.type || 'other';
        const icon = t === 'comment' ? '💬' : t === 'like' ? '❤️' : t === 'message' ? '✉️' : t === 'purchase' ? '💳' : '🔔';
        const cls = t === 'comment' ? 'border-blue-500' : t === 'like' ? 'border-red-500' : t === 'message' ? 'border-green-500' : 'border-yellow-500';
        const when = new Date(noti.created_at).toLocaleString();
        const btn = noti.link ? `<button onclick="handleNotificationClick('${noti.link}', '${noti.id}')" class="text-[10px] bg-gray-700 px-2 py-1 rounded hover:bg-gray-600">이동</button>` : '';
        return `<div class="bg-gray-800/50 p-3 rounded-lg border-l-4 ${noti.is_read ? 'border-gray-600 opacity-60' : cls}">
            <p class="text-xs text-gray-300 mb-1"><span class="mr-2">${icon}</span>${linkifyHtml(noti.content)}</p>
            <div class="flex justify-between items-center"><span class="text-[10px] text-gray-500">${when}</span>${btn}</div>
        </div>`;
    }).join('');
    const modal = document.getElementById('notificationModal');
    if (modal) {
        modal.onmouseenter = cancelNotificationAutoClose;
        modal.onmouseleave = scheduleNotificationAutoClose;
    }
}

window.handleNotificationClick = async function(link, notiId) {
    await client.from('notifications').update({ is_read: true }).eq('id', notiId);
    checkUnreadNotifications();
    closeModal('notificationModal');
    
    if (link.startsWith('post:')) {
        const postId = link.split(':')[1];
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(postId)) return;
        const { data } = await client.from('posts').select(`*, profiles:user_id (nickname)`).eq('id', postId).single();
        if (data) openPostDetail(data);
    } else if (link.startsWith('material:')) {
        const materialId = link.split(':')[1];
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(materialId)) return;
        openMaterialDetail(materialId);
    }
}

window.markAllNotificationsRead = async function() {
    if (!state.user) return;
    await client.from('notifications').update({ is_read: true }).eq('user_id', state.user.id).eq('is_read', false);
    loadNotifications();
    checkUnreadNotifications();
    showToast('모든 전갈을 확인했소.', 'success');
    closeModal('notificationModal');
}

async function checkUnreadNotifications() {
    if (!state.user) return;
    const { count } = await client.from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', state.user.id)
        .eq('is_read', false);
        
    const badge = document.getElementById('noti-badge');
    if (count > 0) {
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function setupRealtimeMessages() {
    if (!state.user) {
        if (state.realtimeChannels['rt_messages']) {
            client.removeChannel(state.realtimeChannels['rt_messages']);
            delete state.realtimeChannels['rt_messages'];
        }
        return;
    }
    checkUnreadMessages();
    ensureChannel('rt_messages', () =>
        client.channel('public:messages')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${state.user.id}` }, payload => {
                if (!state.profile || state.profile.receive_message_noti !== false) {
                    showToast(`💌 새로운 밀서가 당도했소!`, 'info');
                }
                checkUnreadMessages();
                const msgList = document.getElementById('message-list');
                if (!msgList.classList.contains('hidden') && !document.getElementById('messageModal').classList.contains('hidden')) {
                     loadMessageList();
                }
            })
            .subscribe()
    );
}

let notificationAutoCloseTimer = null;
let notificationInactivityHandlerAttached = false;
function scheduleNotificationAutoClose() {
    const modal = document.getElementById('notificationModal');
    if (!modal || modal.classList.contains('hidden')) return;
    const reset = () => {
        cancelNotificationAutoClose();
        notificationAutoCloseTimer = setTimeout(() => {
            const m = document.getElementById('notificationModal');
            if (m && !m.classList.contains('hidden')) closeModal('notificationModal');
        }, 3000);
    };
    if (!notificationInactivityHandlerAttached) {
        const list = document.getElementById('notification-list');
        ['mouseenter','mousemove','wheel','keydown','touchstart','touchmove'].forEach(ev => {
            modal.addEventListener(ev, reset, { passive: true });
            if (list) list.addEventListener(ev, reset, { passive: true });
        });
        notificationInactivityHandlerAttached = true;
    }
    reset();
}
function cancelNotificationAutoClose() {
    if (notificationAutoCloseTimer) {
        clearTimeout(notificationAutoCloseTimer);
        notificationAutoCloseTimer = null;
    }
}

function setupRealtimeNotifications() {
    if (!state.user) return;
    if (state.realtimeChannels['notifications']) client.removeChannel(state.realtimeChannels['notifications']);
    
    const channel = client.channel('public:notifications')
        .on('postgres_changes', { 
            event: 'INSERT', 
            schema: 'public', 
            table: 'notifications', 
            filter: `user_id=eq.${state.user.id}` 
        }, payload => {
            const t = payload.new?.type;
            if (t === 'comment' && state.profile && state.profile.receive_comment_noti === false) return;
            if (t === 'like' && state.profile && state.profile.receive_like_noti === false) return;
            if (t === 'message' && state.profile && state.profile.receive_message_noti === false) return;
            showToast('새로운 전갈이 도착했소!', 'info');
            checkUnreadNotifications();
            if (!document.getElementById('notificationModal').classList.contains('hidden')) {
                loadNotifications();
                scheduleNotificationAutoClose();
            }
        })
        .subscribe();
        
    state.realtimeChannels['notifications'] = channel;
}

async function fetchReports() {
    const { data, error } = await client.from('reports').select('*').order('created_at', { ascending: false });
    if (error) return [];
    return data || [];
}

window.openAdminModal = async function() {
    if (!state.user || state.profile?.role !== 'admin') {
        return showToast('방장 전용이오.', 'error');
    }
    openModal('adminModal');
    switchAdminTab('reports');
}

window.updateReportStatus = async function(id, status) {
    if (!state.user || state.profile?.role !== 'admin') return;
    const { error } = await client.from('reports').update({ status }).eq('id', id);
    if (error) {
        showToast('처리 중 문제가 생겼소.', 'error');
    } else {
        showToast('처리되었소.', 'success');
        loadAdminReports();
    }
}

window.switchAdminTab = function(tab) {
    document.getElementById('admin-reports-area').classList.add('hidden');
    document.getElementById('admin-users-area').classList.add('hidden');
    document.getElementById('admin-broadcast-area').classList.add('hidden');
    const rateArea = document.getElementById('admin-rate-limits-area');
    if (rateArea) rateArea.classList.add('hidden');
    const depArea = document.getElementById('admin-deposits-area');
    if (depArea) depArea.classList.add('hidden');
    document.getElementById('admin-tab-reports').classList.remove('bg-yellow-700','text-black');
    document.getElementById('admin-tab-users').classList.remove('bg-yellow-700','text-black');
    document.getElementById('admin-tab-broadcast').classList.remove('bg-yellow-700','text-black');
    const rateTab = document.getElementById('admin-tab-rate-limits');
    if (rateTab) rateTab.classList.remove('bg-yellow-700','text-black');
    const depTab = document.getElementById('admin-tab-deposits');
    if (depTab) depTab.classList.remove('bg-yellow-700','text-black');
    if (state.realtimeChannels['admin_deposits'] && tab !== 'deposits') {
        client.removeChannel(state.realtimeChannels['admin_deposits']);
        delete state.realtimeChannels['admin_deposits'];
    }
    if (tab === 'reports') {
        document.getElementById('admin-reports-area').classList.remove('hidden');
        document.getElementById('admin-tab-reports').classList.add('bg-yellow-700','text-black');
        loadAdminReports();
    } else if (tab === 'users') {
        document.getElementById('admin-users-area').classList.remove('hidden');
        document.getElementById('admin-tab-users').classList.add('bg-yellow-700','text-black');
        loadAdminUsers();
    } else if (tab === 'broadcast') {
        document.getElementById('admin-broadcast-area').classList.remove('hidden');
        document.getElementById('admin-tab-broadcast').classList.add('bg-yellow-700','text-black');
    } else if (tab === 'deposits') {
        if (depArea) depArea.classList.remove('hidden');
        if (depTab) depTab.classList.add('bg-yellow-700','text-black');
        loadAdminDeposits();
        ensureChannel('admin_deposits', () =>
            client.channel('public:deposit_requests')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'deposit_requests' }, () => loadAdminDeposits())
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'deposit_requests' }, () => loadAdminDeposits())
                .subscribe()
        );
    } else if (tab === 'rate-limits') {
        if (rateArea) rateArea.classList.remove('hidden');
        if (rateTab) rateTab.classList.add('bg-yellow-700','text-black');
        loadAdminRateLimits();
    }
}

async function loadAdminReports() {
    const filter = document.getElementById('reports-filter')?.value || 'all';
    const list = document.getElementById('admin-reports-list');
    list.innerHTML = '<div class="text-center text-gray-500 mt-4 text-xs">고발 기록을 불러오는 중...</div>';
    let q = client.from('reports').select('*').order('created_at', { ascending: false });
    if (filter !== 'all') q = q.eq('status', filter);
    const { data, error } = await q;
    if (error) {
        list.innerHTML = '<div class="text-center text-gray-500 mt-6 text-xs">불러오기에 차질이 생겼소.</div>';
        return;
    }
    const reports = data || [];
    if (!reports.length) {
        list.innerHTML = '<div class="text-center text-gray-500 mt-6 text-xs">접수된 고발이 없소.</div>';
        return;
    }
    list.innerHTML = reports.map(r => `
        <div class="p-3 rounded-lg border border-gray-800 bg-gray-900/40">
            <div class="text-xs text-gray-400 mb-1">${new Date(r.created_at).toLocaleString()} · 상태: ${r.status}</div>
            <div class="text-sm text-white mb-2">[${r.target_type}] ${r.reason}</div>
            <div class="flex gap-2">
                <button onclick="updateReportStatus('${r.id}','resolved')" class="px-2 py-1 text-xs bg-green-700 text-white rounded">처리</button>
                <button onclick="updateReportStatus('${r.id}','dismissed')" class="px-2 py-1 text-xs bg-gray-700 text-white rounded">기각</button>
            </div>
        </div>
    `).join('');
}

async function loadAdminRateLimits() {
    const list = document.getElementById('admin-rate-limits-list');
    if (!list) return;
    list.innerHTML = '<div class="text-center text-gray-500 mt-4 text-xs">레이트 기록을 불러오는 중...</div>';
    const { data, error } = await client.from('rate_limit_logs')
        .select('id,user_id,guest_device_id,action,reason,created_at,profiles:user_id (nickname)')
        .order('created_at', { ascending: false })
        .limit(100);
    if (error) {
        list.innerHTML = '<div class="text-center text-gray-500 mt-6 text-xs">불러오기에 차질이 생겼소.</div>';
        return;
    }
    const rows = data || [];
    if (!rows.length) {
        list.innerHTML = '<div class="text-center text-gray-500 mt-6 text-xs">기록이 없소.</div>';
        return;
    }
    list.innerHTML = rows.map(r => `
        <div class="p-3 rounded-lg border border-gray-800 bg-gray-900/40">
            <div class="text-xs text-gray-400 mb-1">${new Date(r.created_at).toLocaleString()}</div>
            <div class="text-sm text-white mb-1">${r.action}</div>
            <div class="text-[10px] text-gray-500">${r.profiles?.nickname || r.user_id || r.guest_device_id || '알 수 없음'}</div>
            <div class="text-[10px] text-gray-500">${r.reason || ''}</div>
        </div>
    `).join('');
}

async function loadAdminDeposits() {
    const filter = document.getElementById('deposits-filter')?.value || 'requested';
    const qtext = (document.getElementById('deposits-search')?.value || '').trim().toLowerCase();
    const list = document.getElementById('admin-deposits-list');
    if (!list) return;
    list.innerHTML = '<div class="text-center text-gray-500 mt-4 text-xs">입금 확인 요청을 불러오는 중...</div>';
    let q = client.from('deposit_requests')
        .select('id,user_id,material_id,depositor_name,amount,memo,status,created_at,materials:material_id (title, price), profiles:user_id (nickname)')
        .order('created_at', { ascending: false });
    if (filter !== 'all') q = q.eq('status', filter);
    const { data, error } = await q;
    if (error) {
        list.innerHTML = '<div class="text-center text-gray-500 mt-6 text-xs">불러오기에 차질이 생겼소.</div>';
        return;
    }
    let rows = data || [];
    if (qtext) {
        rows = rows.filter(r => {
            const a = (r.depositor_name || '').toLowerCase();
            const b = (r.materials?.title || '').toLowerCase();
            const c = (r.profiles?.nickname || '').toLowerCase();
            return a.includes(qtext) || b.includes(qtext) || c.includes(qtext);
        });
    }
    if (!rows.length) {
        list.innerHTML = '<div class="text-center text-gray-500 mt-6 text-xs">표시할 요청이 없소.</div>';
        return;
    }
    list.innerHTML = rows.map(r => `
        <div class="p-3 rounded-lg border border-gray-800 bg-gray-900/40">
            <div class="flex items-center justify-between">
                <div class="text-xs text-gray-400 mb-1">${new Date(r.created_at).toLocaleString()} · 상태: ${r.status}</div>
                <input type="checkbox" class="dep-select w-4 h-4 accent-yellow-500" data-id="${r.id}">
            </div>
            <div class="text-sm text-white mb-1">${r.materials?.title || '강의 자료'} · <span class="text-yellow-400">${(r.materials?.price||0).toLocaleString()}원</span></div>
            <div class="text-[12px] text-gray-300 mb-1">입금자명: <span class="text-white">${r.depositor_name}</span> · 금액: <span class="text-white">${Number(r.amount).toLocaleString('ko-KR')}원</span></div>
            ${r.memo ? `<div class="text-[11px] text-gray-400 mb-2">메모: ${r.memo}</div>` : ''}
            <div class="flex gap-2">
                <button onclick="confirmDeposit('${r.id}')" class="px-2 py-1 text-xs bg-green-700 text-white rounded">입금 확인</button>
                <button onclick="cancelDeposit('${r.id}')" class="px-2 py-1 text-xs bg-gray-700 text-white rounded">취소</button>
            </div>
        </div>
    `).join('');
}
window.confirmSelectedDeposits = async function() {
    const boxes = Array.from(document.querySelectorAll('#admin-deposits-list .dep-select:checked'));
    if (!boxes.length) return showToast('선택된 요청이 없소.', 'info');
    const ids = boxes.map(b => b.getAttribute('data-id')).filter(Boolean);
    for (const id of ids) {
        await client.from('deposit_requests').update({ status: 'confirmed', confirmed_by: state.user?.id || null }).eq('id', id);
    }
    showToast('선택한 요청을 확인했소.', 'success');
    loadAdminDeposits();
};
window.cancelSelectedDeposits = async function() {
    const boxes = Array.from(document.querySelectorAll('#admin-deposits-list .dep-select:checked'));
    if (!boxes.length) return showToast('선택된 요청이 없소.', 'info');
    const ids = boxes.map(b => b.getAttribute('data-id')).filter(Boolean);
    for (const id of ids) {
        await client.from('deposit_requests').update({ status: 'cancelled', confirmed_by: state.user?.id || null }).eq('id', id);
    }
    showToast('선택한 요청을 취소했소.', 'success');
    loadAdminDeposits();
};

window.confirmDeposit = async function(id) {
    if (!state.user || state.profile?.role !== 'admin') return showToast('방장 전용이오.', 'error');
    const { error } = await client.from('deposit_requests').update({ status: 'confirmed', confirmed_by: state.user.id }).eq('id', id);
    if (error) {
        showToast('확인 처리에 차질이 생겼소.', 'error');
    } else {
        showToast('입금 확인 처리했소.', 'success');
        loadAdminDeposits();
    }
};

window.cancelDeposit = async function(id) {
    if (!state.user || state.profile?.role !== 'admin') return showToast('방장 전용이오.', 'error');
    const { error } = await client.from('deposit_requests').update({ status: 'cancelled', confirmed_by: state.user.id }).eq('id', id);
    if (error) {
        showToast('취소 처리에 차질이 생겼소.', 'error');
    } else {
        showToast('요청을 취소했소.', 'success');
        loadAdminDeposits();
    }
};

async function loadAdminUsers() {
    const q = document.getElementById('admin-user-q').value.trim();
    let query = client.from('profiles').select('id,nickname,role,is_banned').order('created_at', { ascending: false }).limit(50);
    if (q) query = query.ilike('nickname', `%${q}%`);
    const { data, error } = await query;
    const list = document.getElementById('admin-users-list');
    if (error) {
        list.innerHTML = '<div class="text-center text-gray-500 mt-6 text-xs">불러오기에 차질이 생겼소.</div>';
        return;
    }
    const users = data || [];
    if (!users.length) {
        list.innerHTML = '<div class="text-center text-gray-500 mt-6 text-xs">검색 결과가 없소.</div>';
        return;
    }
    list.innerHTML = users.map(u => `
        <div class="p-3 rounded-lg border border-gray-800 bg-gray-900/40 flex items-center justify-between">
            <div>
                <div class="text-sm text-white">${u.nickname || '익명의 협객'}</div>
                <div class="text-[11px] text-gray-500">권한: ${u.role || 'user'} · 금지: ${u.is_banned ? '예' : '아니오'}</div>
            </div>
            <div class="flex gap-2">
                <button onclick="updateUserRole('${u.id}','admin')" class="px-2 py-1 text-xs bg-yellow-700 text-black rounded">방장 승격</button>
                <button onclick="updateUserRole('${u.id}','user')" class="px-2 py-1 text-xs bg-gray-700 text-white rounded">문도 강등</button>
                <button onclick="toggleBan('${u.id}', ${u.is_banned ? 'false' : 'true'})" class="px-2 py-1 text-xs ${u.is_banned ? 'bg-green-700' : 'bg-red-700'} text-white rounded">${u.is_banned ? '해제' : '금지'}</button>
            </div>
        </div>
    `).join('');
}

window.updateUserRole = async function(userId, role) {
    const { error } = await client.from('profiles').update({ role }).eq('id', userId);
    if (error) showToast('권한 변경에 차질이 생겼소.', 'error');
    else { showToast('권한이 변경되었소.', 'success'); loadAdminUsers(); }
}

window.toggleBan = async function(userId, banned) {
    const { error } = await client.from('profiles').update({ is_banned: banned }).eq('id', userId);
    if (error) showToast('금지 설정에 차질이 생겼소.', 'error');
    else { showToast(banned ? '관문 출입을 금했소.' : '금지를 해제했소.', 'success'); loadAdminUsers(); }
}

window.sendBroadcast = async function() {
    const text = document.getElementById('broadcast-content').value.trim();
    if (!text) return showToast('공지 내용을 적으시오.', 'error');
    const { data: users } = await client.from('profiles').select('id');
    const rows = (users || []).map(u => ({ user_id: u.id, type: 'broadcast', content: text, link: null }));
    const { error } = await client.from('notifications').insert(rows);
    if (error) showToast('공지 발송에 차질이 생겼소.', 'error');
    else showToast('공지 발송을 마쳤소.', 'success');
}
document.addEventListener('DOMContentLoaded', init);

async function loadMyDeposits() {
    if (!state.user) return;
    const list = document.getElementById('my-deposits-list');
    if (!list) return;
    list.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">불러오는 중...</div>';
    const { data, error } = await client.from('deposit_requests')
        .select('id,material_id,depositor_name,amount,memo,status,created_at,materials:material_id (title, price)')
        .eq('user_id', state.user.id)
        .order('created_at', { ascending: false })
        .limit(20);
    if (error) { list.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">불러오기에 차질이 있소.</div>'; return; }
    const rows = data || [];
    if (!rows.length) { list.innerHTML = '<div class="text-center text-gray-500 py-6 text-xs">요청 내역이 없소.</div>'; return; }
    list.innerHTML = rows.map(r => `
        <div class="p-3 rounded-lg border border-gray-800 bg-gray-900/40">
            <div class="text-xs text-gray-400 mb-1">${new Date(r.created_at).toLocaleString()} · 상태: ${r.status}</div>
            <div class="text-sm text-white mb-1">${r.materials?.title || '강의 자료'} · <span class="text-yellow-400">${(r.materials?.price||0).toLocaleString()}원</span></div>
            <div class="text-[12px] text-gray-300">입금자명: <span class="text-white">${r.depositor_name}</span> · 금액: <span class="text-white">${Number(r.amount).toLocaleString('ko-KR')}원</span></div>
            ${r.memo ? `<div class="text-[11px] text-gray-400 mt-1">메모: ${r.memo}</div>` : ''}
        </div>
    `).join('');
}

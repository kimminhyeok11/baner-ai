// ------------------------------------------------------------------
// 1. Supabase 설정 & 전역 상태
// ------------------------------------------------------------------
const SUPABASE_URL = 'https://qvwaflyesshwaeprudqo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2d2FmbHllc3Nod2FlcHJ1ZHFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2ODY2MjgsImV4cCI6MjA4NTI2MjYyOH0.oe8KIIMuAzpHExzJBBuWq-oNB6loi4UVUz1EbYwl2L0';
const STORAGE_BUCKET = 'images';

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
    user: null,
    profile: null,
    currentPostId: null,
    postToEdit: null,
    isEditing: false,
    currentStockName: '삼성전자', 
    stockTags: [], 
    realtimeChannels: {},
    guestName: `나그네_${Math.floor(Math.random() * 1000)}`,
    replyToCommentId: null, // 대댓글 대상 ID
    pagination: {
        limit: 10,
        page: 0,
        hasMore: true,
        isLoading: false
    },
    searchQuery: ''
};

const LEVEL_NAMES = ['입문자', '초학자', '시세견습', '기문초해', '자본내공가', '강호시세객', '전략비급사', '시장현경', '초절정투객', '절세투자고수', '금룡장문'];

const MU_GONG_TYPES = [
    { id: 'sword', name: '질풍검법 (단기)', tag: '단기', color: 'text-red-500' },
    { id: 'dao', name: '태극도법 (장기)', tag: '장기', color: 'text-blue-500' },
    { id: 'auto', name: '오토진법 (자동)', tag: '자동', color: 'text-yellow-500' },
];

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
    toast.innerHTML = `<span>${message}</span>`;
    
    container.appendChild(toast);
    
    // Trigger reflow
    toast.offsetHeight;
    toast.classList.add('toast-enter-active');
    toast.classList.remove('toast-enter');

    setTimeout(() => {
        toast.classList.add('toast-exit-active');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

function calculateLevel(postCount, commentCount) {
    const score = (postCount || 0) + (commentCount || 0);
    const idx = Math.min(Math.floor(score / 10), LEVEL_NAMES.length - 1);
    return { name: LEVEL_NAMES[idx], color: idx > 5 ? 'text-yellow-400' : 'text-cyan-400' };
}

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
        submitBtn.innerText = '로그인';
        submitBtn.className = 'w-full py-3.5 text-sm bg-white text-black rounded-xl font-bold hover:bg-gray-200 transition mb-4';
    } else {
        signupTab.className = 'flex-1 pb-3 text-sm font-bold text-white border-b-2 border-white transition';
        loginTab.className = 'flex-1 pb-3 text-sm font-bold text-gray-500 border-b-2 border-transparent transition hover:text-gray-300';
        signupFields.classList.remove('hidden');
        submitBtn.innerText = '가입하기';
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
        showToast('이메일과 비밀번호를 입력해주세요.', 'error'); 
        return;
    }

    if (password.length < 6) {
        showToast('비밀번호는 최소 6자 이상이어야 합니다.', 'error');
        return;
    }

    // 회원가입 시 추가 검증
    if (isSignUp) {
        const passwordConfirm = document.getElementById('auth-password-confirm').value;
        if (password !== passwordConfirm) {
            showToast('비밀번호가 일치하지 않습니다.', 'error');
            return;
        }
        const agreed = document.getElementById('term-agree-chk').checked;
        if (!agreed) {
            showToast('이용약관 및 개인정보처리방침에 동의해야 합니다.', 'error');
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
        showToast(`인증 실패: ${error.message}`, 'error');
    } else {
        if(isSignUp) {
            showToast('입문 신청이 완료되었습니다. 이메일 인증을 확인해주세요.', 'success');
            // 가입 후 로그인 탭으로 전환하거나 모달 닫기 (여기선 닫기)
        } else {
            console.log('성공적으로 문파에 입문했습니다!');
        }
        
        closeModal('authModal');
        checkSession();
    }
}

async function sendPasswordReset() {
    const email = document.getElementById('reset-email').value;
    if (!email) {
        showToast('가입한 이메일 주소를 입력해주세요.', 'error');
        return;
    }
    
    const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.href,
    });

    if (error) {
        showToast(`전송 실패: ${error.message}`, 'error');
    } else {
        showToast('비밀번호 재설정 링크를 이메일로 보냈습니다.', 'success');
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
    client.auth.onAuthStateChange((_event, session) => updateAuthState(session));
}

async function updateAuthState(session) {
    state.user = session ? session.user : null;
    if (state.user) {
        const { data } = await client.from('profiles').select('*').eq('id', state.user.id).single();
        if (data) state.profile = data;
        else state.profile = { nickname: '새로운 문도', post_count: 0, comment_count: 0 };
        
        checkUnreadMessages();
        setupRealtimeMessages();
    } else {
        state.profile = null;
    }
    updateHeaderUI();
}

function updateHeaderUI() {
    const authContainer = document.getElementById('auth-buttons');
    if (state.user && state.profile) {
        const level = calculateLevel(state.profile.post_count, state.profile.comment_count);
        authContainer.innerHTML = `
            <div class="flex items-center space-x-2">
                <span class="text-xs text-gray-400 hidden sm:inline">레벨: <span class="${level.color} font-bold">${level.name}</span></span>
                <span class="text-xs text-gray-400 hidden sm:inline">환영합니다, <span class="text-yellow-400 font-bold">${state.profile.nickname || '문도'}</span>님</span>
                <button onclick="logout()" class="text-xs bg-red-900/50 text-red-200 px-3 py-1 rounded hover:bg-red-900 transition">하산</button>
            </div>
        `;
    } else {
        authContainer.innerHTML = `
            <button onclick="openModal('authModal')" class="text-xs bg-yellow-600 text-white px-3 py-1 rounded font-bold hover:bg-yellow-500 transition shadow-lg animate-pulse">
                입문 (로그인)
            </button>
        `;
    }
}

// ------------------------------------------------------------------
// 4. 이미지/미디어 처리
// ------------------------------------------------------------------

async function uploadImage(file, folderPath) {
    const fileExtension = file.name.split('.').pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExtension}`;
    const filePath = `${folderPath}/${fileName}`;
    
    const { data, error } = await client.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file, { 
            cacheControl: '3600',
            upsert: false,
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
        showToast('이미지 업로드는 로그인 사용자만 가능합니다.', 'error');
        return;
    }
    
    const fileInput = document.getElementById('image-upload-input');
    const file = fileInput.files[0];
    if (!file) return;
    
    try {
        const publicUrl = await uploadImage(file, 'posts');
        const editor = document.getElementById('new-post-content');
        const imgTag = `<img src="${publicUrl}" class="max-w-full h-auto rounded-lg shadow-md my-3" loading="lazy">`;
        editor.focus();
        document.execCommand('insertHTML', false, imgTag);
    } catch (error) {
        showToast(`이미지 업로드 실패: ${error.message}`, 'error');
    } finally {
        fileInput.value = '';
    }
};

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
        showToast('유효한 YouTube URL이 아닙니다.', 'error');
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
        indicator.innerText = '저장됨';
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
        if(confirm('작성 중이던 임시 저장 글이 있습니다. 불러오시겠습니까?')) {
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
    if (type !== 'secret' && !state.user) return showToast('로그인 후 이용 가능합니다.', 'error');

    const title = document.getElementById('new-post-title').value;
    const contentHTML = document.getElementById('new-post-content').innerHTML.trim();

    if (!title || !contentHTML) return showToast('제목과 내용을 입력해주세요.', 'error');

    let stockName = null;
    if (type === 'stock') {
        stockName = document.getElementById('stock-input').value.trim();
        if (!stockName) return showToast('종목명을 입력해야 합니다.', 'error');

        if (!state.isEditing) {
            const { data } = await client.from('stock_tags').select('name').eq('name', stockName);
            if (data.length === 0) {
                await client.from('stock_tags').insert({ name: stockName });
                await fetchStockTags();
            }
        }
    }

    // 암천객잔 제한 체크
    if (type === 'secret' && !state.user) {
        const today = new Date().toISOString().split('T')[0];
        const count = parseInt(localStorage.getItem(`post_count_${today}`) || '0');
        if (count >= 3) return showToast('하루에 3개의 익명 게시글만 작성할 수 있습니다.', 'error');
    }

    const payload = {
        title, content: contentHTML, type, 
        stock_id: stockName,
        mugong_id: type === 'public' ? document.getElementById('mu-gong-select').value : null,
    };

    let error;
    
    if (state.isEditing) {
        if(!state.user) return showToast('익명 글은 수정할 수 없습니다.', 'error');
        const { error: updateError } = await client.from('posts').update(payload).eq('id', state.currentPostId).eq('user_id', state.user.id);
        error = updateError;
    } else {
        payload.user_id = state.user ? state.user.id : null;
        payload.guest_nickname = state.user ? null : `나그네(${Math.floor(Math.random()*1000)})`;
        payload.view_count = 0;
        payload.like_count = 0;
        const { error: insertError } = await client.from('posts').insert(payload);
        error = insertError;
    }

    if (error) {
        console.error(`실패:`, error);
        showToast('저장 중 오류가 발생했습니다.', 'error');
    } else {
        if(!state.isEditing) clearTempPost();
        
        if (type === 'secret' && !state.user) {
            const today = new Date().toISOString().split('T')[0];
            const currentCount = parseInt(localStorage.getItem(`post_count_${today}`) || '0');
            localStorage.setItem(`post_count_${today}`, currentCount + 1);
        }

        closeModal('newPostModal');
        showToast('비급이 성공적으로 등록되었습니다.', 'success');
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
    
    const { error } = await client.from('posts').delete().eq('id', postId).eq('user_id', state.user.id);
    
    if (error) {
        showToast('삭제 권한이 없거나 오류가 발생했습니다.', 'error');
    } else {
        showToast('비급이 삭제되었습니다.', 'success');
        closeModal('postDetailModal');
        navigate(document.querySelector('.app-view:not(.hidden)').id);
    }
}

// ------------------------------------------------------------------
// 6. UI: 네비게이션 & 렌더링
// ------------------------------------------------------------------

function navigate(viewId, pushHistory = true) {
    document.querySelectorAll('.app-view').forEach(el => el.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('text-yellow-400', 'border-yellow-400');
        btn.classList.add('text-gray-500', 'border-transparent');
    });

    const activeBtn = document.querySelector(`button[onclick*="navigate('${viewId}')"]`);
    if (activeBtn) {
        activeBtn.classList.replace('text-gray-500', 'text-yellow-400');
        activeBtn.classList.replace('border-transparent', 'border-yellow-400');
    }

    if (pushHistory) {
        window.history.pushState({ viewId }, null, `#${viewId}`);
    }

    if (viewId === 'gangho-plaza') renderPosts('posts-list-public', 'public');
    if (viewId === 'stock-board') {
        if(state.stockTags.length === 0) fetchStockTags();
        else renderPosts('posts-list-stock', 'stock', state.currentStockName);
    }
    if (viewId === 'secret-inn') renderPosts('posts-list-secret', 'secret');
    if (viewId === 'chat-hall') loadChat();
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

    tagsToRender.forEach(tag => {
        const btn = document.createElement('button');
        const isActive = state.currentStockName === tag;
        btn.className = `px-3 py-1 rounded-full text-xs whitespace-nowrap transition border ${
            isActive ? 'bg-green-800 text-white border-green-600 font-bold shadow-md' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'
        }`;
        btn.innerText = tag;
        btn.onclick = () => {
            state.currentStockName = tag;
            renderStockTabs();
            renderPosts('posts-list-stock', 'stock', tag);
            document.getElementById('current-stock-name').innerText = tag;
        };
        stockTabs.appendChild(btn);
    });
}

function renderStockOptions() { 
    const dataList = document.getElementById('stock-options');
    dataList.innerHTML = state.stockTags.map(tag => `<option value="${tag}">`).join('');
}

async function fetchPosts(type, stockName = null, isLoadMore = false) {
    if (state.pagination.isLoading) return;
    state.pagination.isLoading = true;

    if (!isLoadMore) {
        state.pagination.page = 0;
        state.pagination.hasMore = true;
    }

    const from = state.pagination.page * state.pagination.limit;
    const to = from + state.pagination.limit - 1;

    let query = client.from('posts')
        .select(`*, profiles:user_id (nickname, post_count, comment_count)`) 
        .eq('type', type)
        .order('created_at', { ascending: false })
        .range(from, to);

    if (stockName) query = query.eq('stock_id', stockName);
    if (state.searchQuery) {
        query = query.ilike('title', `%${state.searchQuery}%`);
    }

    const { data, error } = await query;
    state.pagination.isLoading = false;

    if (error) {
        showToast('비급을 불러오는 중 문제가 발생했습니다.', 'error');
        return [];
    }

    if (data.length < state.pagination.limit) {
        state.pagination.hasMore = false;
    } else {
        state.pagination.page++;
    }
    
    return data || [];
}

function createPostElement(post) {
    const author = post.profiles?.nickname || post.guest_nickname || '익명 문도';
    const level = post.profiles ? calculateLevel(post.profiles.post_count, post.profiles.comment_count) : { name: '입문자', color: 'text-gray-500' };
    const mugong = MU_GONG_TYPES.find(m => m.id === post.mugong_id);
    const isSecret = post.type === 'secret';

    const postEl = document.createElement('div');
    postEl.className = 'bg-[#1f2937] p-4 rounded-xl shadow-lg border border-gray-700 hover:border-yellow-600 transition cursor-pointer';
    postEl.onclick = () => openPostDetail(post);

    postEl.innerHTML = `
        <div class="flex justify-between items-start mb-2">
            <h4 class="text-white font-semibold truncate text-base flex-1">${post.title}</h4>
            ${!isSecret ? `<span class="text-[10px] text-gray-500 ml-2 bg-gray-800 px-2 py-1 rounded flex items-center gap-1">👁 ${post.view_count || 0} ❤️ ${post.like_count || 0}</span>` : ''}
        </div>
        <div class="text-xs text-gray-400 flex justify-between items-center">
            <div class="flex items-center space-x-2">
                <span class="${level.color} font-medium">${level.name}</span>
                <span class="text-yellow-400">${author}</span>
                ${mugong ? `<span class="px-2 py-0.5 rounded-full text-[10px] bg-gray-700 ${mugong.color}">${mugong.tag}</span>` : ''}
            </div>
            <span class="text-gray-500">${new Date(post.created_at).toLocaleDateString()}</span>
        </div>
    `;
    return postEl;
}

async function renderPosts(containerId, type, stockName = null) {
    const container = document.getElementById(containerId);
    
    // 검색바 주입
    let searchContainer = document.getElementById(`search-${type}`);
    if (!searchContainer) {
        const searchDiv = document.createElement('div');
        searchDiv.id = `search-${type}`;
        searchDiv.className = 'mb-4 flex gap-2';
        searchDiv.innerHTML = `
            <input type="text" placeholder="비급 제목 검색..." class="flex-grow bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm" onkeydown="if(event.key==='Enter') handleSearch('${type}', '${containerId}', '${stockName || ''}', this.value)">
            <button onclick="handleSearch('${type}', '${containerId}', '${stockName || ''}', this.previousElementSibling.value)" class="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-600">검색</button>
        `;
        container.parentNode.insertBefore(searchDiv, container);
    }

    container.innerHTML = '<div class="text-center text-gray-500 py-10">... 비급을 로딩 중 ...</div>';
    state.searchQuery = ''; 
    
    const posts = await fetchPosts(type, stockName, false);
    container.innerHTML = ''; 

    if (posts.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 py-10">등록된 비급이 없습니다.</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    posts.forEach(post => fragment.appendChild(createPostElement(post)));
    container.appendChild(fragment);

    renderLoadMoreButton(container, type, stockName);
}

window.handleSearch = async function(type, containerId, stockName, query) {
    state.searchQuery = query;
    const container = document.getElementById(containerId);
    container.innerHTML = '<div class="text-center text-gray-500 py-10">... 비급을 찾는 중 ...</div>';
    
    const posts = await fetchPosts(type, stockName || null, false);
    container.innerHTML = '';

    if (posts.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 py-10">검색된 비급이 없습니다.</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    posts.forEach(post => fragment.appendChild(createPostElement(post)));
    container.appendChild(fragment);

    renderLoadMoreButton(container, type, stockName || null);
}

function renderLoadMoreButton(container, type, stockName) {
    const existingBtn = container.nextElementSibling;
    if (existingBtn && existingBtn.id === 'load-more-btn') existingBtn.remove();

    if (state.pagination.hasMore) {
        const btn = document.createElement('button');
        btn.id = 'load-more-btn';
        btn.className = 'w-full py-3 mt-4 text-sm text-gray-400 bg-gray-800/50 rounded-lg hover:bg-gray-800 hover:text-white transition';
        btn.innerText = '비급 더 불러오기';
        btn.onclick = async () => {
            btn.innerText = '로딩 중...';
            const posts = await fetchPosts(type, stockName, true);
            if (posts.length > 0) {
                const fragment = document.createDocumentFragment();
                posts.forEach(post => fragment.appendChild(createPostElement(post)));
                container.appendChild(fragment);
            }
            if (!state.pagination.hasMore) btn.remove();
            else btn.innerText = '비급 더 불러오기';
        };
        container.parentNode.appendChild(btn);
    }
}

window.openPostDetail = async function(post) {
    state.currentPostId = post.id;
    state.postToEdit = post;
    const modal = document.getElementById('postDetailModal');
    
    if (post.type !== 'secret') {
        const newViewCount = (post.view_count || 0) + 1;
        await client.from('posts').update({ view_count: newViewCount }).eq('id', post.id);
        document.getElementById('detail-views').innerText = newViewCount;
    }

    document.getElementById('detail-title').innerText = post.title;
    document.getElementById('detail-content').innerHTML = post.content;
    
    const author = post.profiles?.nickname || post.guest_nickname || '익명 문도';
    document.getElementById('detail-author').innerText = author;
    document.getElementById('detail-likes').innerText = post.like_count || 0;

    const metaContainer = document.getElementById('detail-meta-container');
    if (post.type === 'secret') {
        metaContainer.classList.add('hidden');
    } else {
        metaContainer.classList.remove('hidden');
    }
    
    const isAuthor = state.user?.id === post.user_id;
    document.getElementById('delete-post-btn').classList.toggle('hidden', !isAuthor);
    document.getElementById('edit-post-btn').classList.toggle('hidden', !isAuthor);
    
    // 쪽지 보내기 버튼 로직
    const msgBtn = document.getElementById('btn-send-msg');
    if (msgBtn) {
        // 로그인 상태이고, 작성자가 본인이 아니며, 작성자가 익명이 아닐 때
        const canSendMsg = state.user && !isAuthor && post.user_id;
        msgBtn.classList.toggle('hidden', !canSendMsg);
        msgBtn.onclick = () => openMessageCompose(post.user_id, author);
    }
    
    document.getElementById('delete-post-btn').onclick = () => {
        document.getElementById('confirm-delete-title').innerText = state.postToEdit.title;
        openModal('deleteConfirmModal');
    };
    document.getElementById('edit-post-btn').onclick = () => openPostEditModal(post);
    
    loadComments(post.id);
    modal.classList.remove('hidden');
}

window.toggleLike = async function() {
    if (!state.user) return showToast('좋아요는 로그인 후 가능합니다.', 'error');
    if (state.postToEdit.type === 'secret') return; 

    const likeKey = `liked_${state.currentPostId}_${state.user.id}`;
    if (localStorage.getItem(likeKey)) {
        return showToast('이미 추천한 비급입니다.', 'info');
    }

    const newLikeCount = (state.postToEdit.like_count || 0) + 1;
    const { error } = await client.from('posts').update({ like_count: newLikeCount }).eq('id', state.currentPostId);
    
    if (!error) {
        document.getElementById('detail-likes').innerText = newLikeCount;
        state.postToEdit.like_count = newLikeCount;
        localStorage.setItem(likeKey, 'true');
        showToast('비급을 추천했습니다.', 'success');
    }
}

window.openPostEditModal = function(post) {
    closeModal('postDetailModal');
    state.isEditing = true;
    state.currentPostId = post.id;
    state.postToEdit = post;
    
    document.getElementById('post-modal-title').innerText = '비급 수정';
    document.getElementById('save-post-btn').innerText = '수정 완료';

    document.getElementById(`type-${post.type}`).checked = true;
    togglePostTypeFields(post.type);
    document.getElementById('new-post-title').value = post.title;
    document.getElementById('new-post-content').innerHTML = post.content;
    
    if (post.type === 'stock') document.getElementById('stock-input').value = post.stock_id;
    if (post.type === 'public') document.getElementById('mu-gong-select').value = post.mugong_id;

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

function createCommentNode(comment, allChildren, depth = 0) {
    const author = comment.profiles?.nickname || comment.guest_nickname || '익명';
    const level = comment.profiles ? calculateLevel(comment.profiles.post_count, comment.profiles.comment_count) : { name: '입문자', color: 'text-gray-500' };
    const margin = depth * 20;

    const wrapper = document.createElement('div');
    wrapper.className = 'mb-2';
    
    const commentEl = document.createElement('div');
    commentEl.className = `p-2 rounded-lg ${depth > 0 ? 'bg-gray-800/50 border-l-2 border-gray-600' : 'bg-gray-700/50'} relative`;
    commentEl.style.marginLeft = `${margin}px`;
    
    commentEl.innerHTML = `
        <p class="text-[10px] text-gray-400 mb-1 flex justify-between">
            <span>
                <span class="${level.color}">${level.name}</span>
                <span class="text-yellow-300 font-medium">${author}</span>
            </span>
            <span>${new Date(comment.created_at).toLocaleTimeString()}</span>
        </p>
        <p class="text-xs text-gray-200">${comment.content}</p>
        <button onclick="setReplyTarget('${comment.id}', '${author}')" class="text-[10px] text-gray-500 hover:text-gray-300 mt-1">↪ 답글</button>
    `;
    wrapper.appendChild(commentEl);

    const replies = allChildren.filter(c => c.parent_id === comment.id);
    replies.forEach(reply => {
        wrapper.appendChild(createCommentNode(reply, allChildren, depth + 1));
    });

    return wrapper;
}

window.setReplyTarget = function(commentId, authorName) {
    state.replyToCommentId = commentId;
    const input = document.getElementById('comment-input');
    input.placeholder = `@${authorName} 님에게 답글 작성 중...`;
    input.focus();
    
    let cancelBtn = document.getElementById('cancel-reply-btn');
    if(!cancelBtn) {
        cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancel-reply-btn';
        cancelBtn.innerText = 'x';
        cancelBtn.className = 'text-red-400 text-xs px-2 font-bold';
        cancelBtn.onclick = () => {
            state.replyToCommentId = null;
            input.placeholder = '댓글 입력...';
            cancelBtn.remove();
        };
        input.parentNode.insertBefore(cancelBtn, input.nextSibling);
    }
}

async function addComment() {
    const postId = state.currentPostId;
    const input = document.getElementById('comment-input');
    const content = input.value.trim();
    if (!content || !postId) return;

    if (!state.user) {
        const today = new Date().toISOString().split('T')[0];
        const count = parseInt(localStorage.getItem(`comment_count_${today}`) || '0');
        if (count >= 10) {
            showToast('하루에 10개의 익명 댓글만 작성할 수 있습니다.', 'error');
            return;
        }
    }

    const payload = {
        post_id: postId,
        content: content,
        user_id: state.user?.id || null,
        guest_nickname: state.user ? null : `나그네(${Math.floor(Math.random()*1000)})`,
        parent_id: state.replyToCommentId || null
    };

    const { error } = await client.from('comments').insert(payload);
    if (error) {
        console.error('댓글 등록 실패:', error);
        showToast('댓글 등록에 실패했습니다.', 'error');
    } else {
        input.value = '';
        
        if (!state.user) {
            const today = new Date().toISOString().split('T')[0];
            const currentCount = parseInt(localStorage.getItem(`comment_count_${today}`) || '0');
            localStorage.setItem(`comment_count_${today}`, currentCount + 1);
        }

        state.replyToCommentId = null;
        input.placeholder = '댓글 입력...';
        const cancelBtn = document.getElementById('cancel-reply-btn');
        if(cancelBtn) cancelBtn.remove();
    }
}

function setupRealtimeComments(postId) {
    const channelKey = `comments_${postId}`;
    if (state.realtimeChannels[channelKey]) client.removeChannel(state.realtimeChannels[channelKey]);
    const channel = client.channel(channelKey)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` }, 
            () => loadComments(postId)
        ).subscribe();
    state.realtimeChannels[channelKey] = channel;
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
        const author = msg.profiles?.nickname || msg.guest_nickname || '익명 문도';
        const msgEl = document.createElement('div');
        msgEl.className = 'text-xs mb-1';
        msgEl.innerHTML = `<span class="text-yellow-400 font-medium">${author}:</span> <span class="text-gray-300">${msg.content}</span>`;
        fragment.appendChild(msgEl);
    });
    chatList.appendChild(fragment);
    chatList.scrollTop = chatList.scrollHeight;
}

async function sendChat() {
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content) return;
    const payload = { content: content, user_id: state.user?.id || null, guest_nickname: state.user ? null : state.guestName };
    const { error } = await client.from('chat_messages').insert(payload);
    if (!error) input.value = '';
}

function setupRealtimeChat() {
     if (state.realtimeChannels['chat']) client.removeChannel(state.realtimeChannels['chat']);
    const channel = client.channel('chat').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => loadChat()).subscribe();
    state.realtimeChannels['chat'] = channel;
}

// ------------------------------------------------------------------
// 8. 쪽지 (Messages)
// ------------------------------------------------------------------

async function fetchMessages() {
    if (!state.user) return;
    
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
        if (count > 0) {
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

window.openMessageModal = async function() {
    if (!state.user) {
        showToast('로그인이 필요한 기능입니다.', 'error');
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
    list.innerHTML = '<div class="text-center text-gray-500 mt-4">불러오는 중...</div>';
    
    const messages = await fetchMessages();
    list.innerHTML = '';
    
    if (messages.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-500 mt-10">받은 쪽지가 없습니다.</div>';
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
            <p class="text-sm text-gray-300 truncate">${msg.content}</p>
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
                <div class="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">${msg.content}</div>
            </div>
            <button onclick="openMessageCompose('${msg.sender_id}', '${sender}')" class="self-end bg-yellow-600 text-black font-bold px-4 py-2 rounded-lg text-sm hover:bg-yellow-500">답장하기</button>
        </div>
    `;
}

window.openMessageCompose = function(receiverId, receiverName) {
    if (!state.user) {
        showToast('로그인이 필요합니다.', 'error');
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
    const receiverId = document.getElementById('msg-receiver-name').dataset.id;
    const content = document.getElementById('msg-content').value.trim();
    
    if (!content) {
        showToast('내용을 입력해주세요.', 'error');
        return;
    }
    
    const { error } = await client.from('messages').insert({
        sender_id: state.user.id,
        receiver_id: receiverId,
        content: content
    });
    
    if (error) {
        showToast('전송 실패: ' + error.message, 'error');
    } else {
        showToast('쪽지를 보냈습니다.', 'success');
        cancelMessage(); // 목록으로 복귀
    }
}

// ------------------------------------------------------------------
// 9. 초기화 및 이벤트 리스너
// ------------------------------------------------------------------

function resetPostStateAndUI() {
    state.isEditing = false;
    state.postToEdit = null;
    state.currentPostId = null; 
    document.getElementById('post-modal-title').innerText = '비급 작성';
    
    const saveBtn = document.getElementById('save-post-btn');
    if(saveBtn) saveBtn.innerText = '등록';

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
        title.innerText = '이용약관 (Terms of Service)';
        content.innerHTML = `
            <h4 class="font-bold mb-2">제1조 (목적)</h4>
            <p class="mb-2">본 약관은 천금문(이하 '회사')이 제공하는 서비스의 이용조건 및 절차, 이용자와 회사의 권리, 의무, 책임사항을 규정함을 목적으로 합니다.</p>
            <h4 class="font-bold mb-2">제2조 (면책)</h4>
            <p class="mb-2">본 커뮤니티에서 제공되는 투자 정보는 참고용일 뿐이며, 투자의 책임은 전적으로 사용자 본인에게 있습니다.</p>
            <p>더 상세한 내용은 실제 운영 시 법률 전문가의 자문을 받아 작성해야 합니다.</p>
        `;
    } else {
        title.innerText = '개인정보처리방침 (Privacy Policy)';
        content.innerHTML = `
            <h4 class="font-bold mb-2">1. 수집하는 개인정보 항목</h4>
            <p class="mb-2">이메일 주소, 접속 로그, 쿠키, 닉네임 등.</p>
            <h4 class="font-bold mb-2">2. 개인정보의 보유 및 이용기간</h4>
            <p class="mb-2">회원은 탈퇴 시까지 정보를 보유하며, 법령에 따른 보존 기간 동안은 보관됩니다.</p>
        `;
    }
}

function init() {
    const mugongSel = document.getElementById('mu-gong-select');
    MU_GONG_TYPES.forEach(m => mugongSel.innerHTML += `<option value="${m.id}">${m.name}</option>`);
    fetchStockTags();
    window.onpopstate = () => {
        const hash = window.location.hash.replace('#', '');
        if (hash) {
            if (hash.startsWith('post-')) {
                navigate('gangho-plaza'); 
            } else {
                navigate(hash, false);
            }
        } else {
            navigate('gangho-plaza', false);
        }
    };

    const initialHash = window.location.hash.replace('#', '');
    if(initialHash && document.getElementById(initialHash)) {
        navigate(initialHash, false);
    } else {
        navigate('gangho-plaza', false);
    }
    
    window.onclick = function(event) {
        if (event.target.classList.contains('fixed')) {
            event.target.classList.add('hidden');
        }
    }
    
    setupGlobalRealtime();
}

// ------------------------------------------------------------------
// 10. 글로벌 실시간 (Posts, Messages, StockTags)
// ------------------------------------------------------------------

function setupGlobalRealtime() {
    // 1. Posts (모든 게시글 변경 감지)
    const postChannel = client.channel('public:posts')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, payload => {
            handleNewPostRealtime(payload.new);
        })
        .subscribe();
    state.realtimeChannels['global_posts'] = postChannel;

    // 2. Messages (나에게 온 쪽지)
    const msgChannel = client.channel('public:messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            if (state.user && payload.new.receiver_id === state.user.id) {
                showToast(`💌 새로운 쪽지가 도착했습니다!`, 'info');
                checkUnreadMessages(); // 배지 업데이트
                
                // 만약 쪽지함이 열려있다면 리스트 갱신
                const msgList = document.getElementById('message-list');
                if (!msgList.classList.contains('hidden') && !document.getElementById('messageModal').classList.contains('hidden')) {
                     // 전체 리로드보다는 맨 위에 추가하는게 좋지만, 간단히 리로드
                     loadMessageList();
                }
            }
        })
        .subscribe();
    state.realtimeChannels['global_messages'] = msgChannel;

    // 3. Stock Tags (새로운 종목 추가)
    const stockChannel = client.channel('public:stock_tags')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stock_tags' }, payload => {
            // 태그 목록 갱신
            state.stockTags.push(payload.new.name);
            renderStockTabs();
            renderStockOptions();
            showToast(`📈 새로운 종목 [${payload.new.name}]이(가) 등록되었습니다!`, 'info');
        })
        .subscribe();
    state.realtimeChannels['global_stocks'] = stockChannel;
}

async function handleNewPostRealtime(newPost) {
    // 현재 보고 있는 뷰 타입 확인
    const currentView = window.getCurrentViewType(); // 'public', 'stock', 'secret'
    
    // 새 글이 현재 뷰와 관련 있는지 확인
    let isRelevant = false;
    let containerId = '';

    if (newPost.type === 'public' && currentView === 'public') {
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
            const newEl = createPostElement(fullPost);
            newEl.classList.add('animate-pulse'); // 강조 효과
            
            // 검색 중이 아닐 때만 맨 위에 추가
            if (!state.searchQuery) {
                if (container.firstChild) {
                    container.insertBefore(newEl, container.firstChild);
                } else {
                    container.appendChild(newEl);
                }
                setTimeout(() => newEl.classList.remove('animate-pulse'), 2000);
            }
        }
    }
    
    // 알림은 뷰와 상관없이 띄울 수도 있지만, 너무 많으면 방해되므로 현재 뷰와 다를 때만 띄우거나 생략
    // 여기서는 "실시간 응답"을 위해 현재 뷰가 아니더라도 중요 알림(예: 내 종목) 등을 띄울 수 있음.
    // 일단은 현재 뷰에 추가되었을 때 토스트
    if (isRelevant) {
        showToast('새로운 비급이 실시간으로 도착했습니다!', 'success');
    }
}


// 전역 함수 매핑 (HTML 이벤트 핸들러용)
window.openModal = (id) => document.getElementById(id).classList.remove('hidden');
window.closeModal = (id) => {
    document.getElementById(id).classList.add('hidden');
    if (id === 'newPostModal') resetPostStateAndUI();
};
window.navigate = navigate;
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
    return 'public';
};

window.tryOpenWriteModal = (type) => {
    if (type !== 'secret' && !state.user) {
        if(confirm('비급 기록은 로그인 사용자만 가능합니다. 로그인하시겠습니까?')) openModal('authModal');
        return;
    }
    
    if (type === 'secret' && !state.user) {
        const today = new Date().toISOString().split('T')[0];
        const count = parseInt(localStorage.getItem(`post_count_${today}`) || '0');
        if (count >= 3) {
            showToast('하루에 3개의 익명 게시글만 작성할 수 있습니다.', 'error');
            return;
        }
    }

    resetPostStateAndUI(); 
    document.getElementById(`type-${type}`).checked = true;
    togglePostTypeFields(type);
    openModal('newPostModal');
    if (type === 'stock') document.getElementById('stock-input').value = state.currentStockName;
    
    checkAndLoadTempPost();
    document.getElementById('new-post-content').focus();
};

window.togglePostTypeFields = (type) => {
    document.getElementById('mu-gong-area').classList.toggle('hidden', type !== 'public');
    document.getElementById('stock-area').classList.toggle('hidden', type !== 'stock');
    document.querySelectorAll('input[name="post-type"]').forEach(radio => radio.disabled = state.isEditing);
};

window.togglePreview = function() {
    const previewArea = document.getElementById('preview-mode-area');
    const btn = document.getElementById('preview-btn');
    const toolbar = document.querySelector('.editor-toolbar');
    
    if (previewArea.classList.contains('hidden')) {
        const title = document.getElementById('new-post-title').value;
        const content = document.getElementById('new-post-content').innerHTML;
        
        if (!title && !content.trim()) return showToast('미리볼 내용이 없습니다.', 'error');

        document.getElementById('preview-title-text').innerText = title || '(제목 없음)';
        document.getElementById('preview-body-content').innerHTML = content || '(내용 없음)';
        
        previewArea.classList.remove('hidden');
        btn.innerText = '편집 계속';
        toolbar.classList.add('hidden'); 
    } else {
        previewArea.classList.add('hidden');
        btn.innerText = '미리보기';
        toolbar.classList.remove('hidden');
    }
};

window.handleYouTubeEmbed = window.openYouTubeModal;

document.addEventListener('DOMContentLoaded', init);

# 천금문 (千金門) 개발자 가이드

## 프로젝트 개요
천금문은 한국 무림 세계관을 차용한 주식/코인 투자 커뮤니티입니다.
HTML, CSS, Vanilla JavaScript로 구축된 SPA(Single Page Application)이며, Supabase를 백엔드로 사용합니다.

## 기술 스택
- **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6+)
- **CSS Framework**: Tailwind CSS (CDN 방식)
- **Backend**: Supabase (Database, Auth, Storage, Edge Functions)
- **Hosting**: Vercel (권장)

## 폴더 구조
```
/
├── css/                # 스타일시트 (style.css, style_ticker.css)
├── js/                 # 자바스크립트 소스 (app.js)
├── scripts/            # 빌드 및 유틸리티 스크립트 (build.ps1)
├── server/             # 서버측 코드 (Supabase Edge Functions, Vercel API)
├── sql/                # 데이터베이스 스키마 및 마이그레이션 SQL (schema.sql 등)
├── index.html          # 메인 진입점
├── robots.txt          # 검색 엔진 크롤링 설정
├── sitemap.xml         # 사이트맵 (생성된 파일)
├── rss.xml            # RSS 피드 (생성된 파일)
└── DEVELOPER_GUIDE.md  # 본 문서
```

## 주요 기능 및 구현 현황

### 1. SEO (검색 엔진 최적화)
- **Routing**: History API(`pushState`)를 사용하여 `/stock-board`, `/post/123` 등의 깔끔한 URL을 지원합니다.
- **Meta Tags**: `app.js`의 `updateMetaTagsForView()` 함수가 페이지 이동 시마다 동적으로 `<title>`, `<meta description>`, Open Graph 태그를 업데이트합니다.
- **Structured Data**: JSON-LD를 동적으로 주입하여 검색 엔진이 게시글 정보를 "DiscussionForumPosting"으로 인식하도록 했습니다.
- **Sitemap/Robots**: `robots.txt`가 설정되어 있으며, 추후 sitemap.xml 자동 생성 기능을 Edge Function 등으로 구현할 것을 권장합니다.

### 2. UI/UX
- **전광판 (Ticker)**: 메인 화면 상단에 흐르는 뉴스/시세 티커가 구현되어 있습니다 (`style_ticker.css`).
- **다크 모드**: 기본적으로 어두운 테마(Dark Theme)를 사용하며 Tailwind CSS로 스타일링되었습니다.

### 3. 데이터베이스 (Supabase)
- `sql/` 폴더 내에 테이블 생성 및 RLS(Row Level Security) 정책 SQL이 포함되어 있습니다.
- 주요 테이블: `profiles`, `posts`, `comments`, `post_likes`, `journal_entries` 등.

## 개발 가이드 (How to Continue)

### 로컬 실행 방법
이 프로젝트는 별도의 빌드 과정이 필요 없으나, CORS 문제 방지를 위해 로컬 웹 서버가 필요합니다.
VS Code의 'Live Server' 확장을 사용하거나, Node.js가 설치되어 있다면 다음 명령어로 실행하세요:
```bash
npx serve .
```

### 다음 개발자를 위한 할 일 (To-Do)
1. **코드 모듈화**: 현재 `js/app.js`가 매우 큽니다(5000줄 이상). 이를 `modules/` 폴더를 만들어 기능별(auth.js, router.js, ui.js 등)로 분리하는 리팩토링이 필요합니다. (ES Modules 도입 필요)
2. **SSR 도입 고려**: 현재 동적 메타 태그는 클라이언트 사이드에서 작동하므로, SNS 공유 시 미리보기(OG Tag)가 완벽하지 않을 수 있습니다. 완벽한 SEO를 위해서는 Vercel Edge Functions를 활용한 메타 태그 주입이나 Next.js로의 마이그레이션을 고려해야 합니다.
3. **관리자 기능 강화**: 현재 기본적인 관리자 기능만 구현되어 있습니다. 신고 처리 및 유저 제재 기능을 강화해야 합니다.

## 배포
Vercel에 배포 시 `index.html`을 진입점으로 설정하고, SPA 라우팅을 위해 `vercel.json`에 Rewrites 설정을 추가해야 할 수 있습니다.

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

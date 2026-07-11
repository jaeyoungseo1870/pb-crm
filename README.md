# PB 고객관리시스템 — 배포 가이드

GitHub + Vercel + Supabase를 이용해 팀원 3명이 함께 쓰는 실제 웹 서비스로 배포하는 방법입니다.
개발 지식이 없어도 순서대로 따라 하면 약 20~30분이면 완료됩니다. (모두 무료 플랜으로 가능)

## 전체 구조

```
[팀원 브라우저] ←→ [Vercel: 웹사이트 호스팅] ←→ [Supabase: 로그인 + 데이터베이스]
                        ↑
                 [GitHub: 코드 저장소]
```

- **GitHub** : 코드를 보관하는 곳. 여기에 파일을 올리면 Vercel이 자동으로 사이트를 갱신합니다.
- **Vercel** : 웹사이트를 인터넷에 공개해 주는 호스팅 서비스. `https://앱이름.vercel.app` 주소가 생깁니다.
- **Supabase** : 회원가입/로그인과 고객 데이터를 저장하는 데이터베이스(PostgreSQL).

---

## 1단계. Supabase 설정 (데이터베이스 + 로그인)

1. https://supabase.com 접속 → GitHub 계정으로 가입 → **New project** 클릭
   - Name: `pb-crm` / Database Password: 아무거나 강력하게 (따로 메모) / Region: **Northeast Asia (Seoul)**
2. 프로젝트가 생성되면 왼쪽 메뉴 **SQL Editor** 클릭 → **New query**
3. 이 폴더의 `supabase-schema.sql` 파일을 메모장으로 열어 **전체 복사** → 붙여넣기 → **Run** 클릭
   - "Success" 가 나오면 테이블 생성 완료 (고객/수익률/잠재고객/팀원, 3명 가입 제한 포함)
4. 왼쪽 메뉴 **Authentication → Sign In / Up → Email** 에서
   - **Confirm email 을 끄기(OFF)** 로 변경 → Save
   - (끄지 않으면 가입 시 이메일 인증 절차가 추가됩니다. 팀 내부용이므로 꺼도 됩니다)
5. 왼쪽 아래 **Project Settings → API** 에서 두 값을 복사해 둡니다.
   - `Project URL` (https://xxxx.supabase.co)
   - `anon` `public` 키 (긴 문자열)

## 2단계. config.js 수정

이 폴더의 `config.js` 를 메모장으로 열어 1단계에서 복사한 값을 붙여넣고 저장합니다.

```js
const SUPABASE_URL = "https://xxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

> anon public 키는 웹페이지에 노출되어도 되는 공개용 키입니다.
> 실제 데이터 보호는 데이터베이스의 보안 규칙(RLS)이 담당합니다.
> 단, **service_role 키는 절대 이 파일에 넣으면 안 됩니다.**

## 3단계. GitHub에 코드 올리기

1. https://github.com 가입 → 우측 상단 **+ → New repository**
   - Repository name: `pb-crm` / **Private** 선택 (권장) → Create repository
2. 만들어진 저장소 화면에서 **uploading an existing file** 링크 클릭
3. 이 폴더의 파일 4개(`index.html`, `app.js`, `config.js`, `supabase-schema.sql`)를
   드래그해서 올리고 → **Commit changes** 클릭

## 4단계. Vercel로 배포

1. https://vercel.com 접속 → **Continue with GitHub** 로 가입
2. **Add New → Project** → 방금 만든 `pb-crm` 저장소 옆 **Import** 클릭
3. 설정은 그대로 두고 **Deploy** 클릭 (별도 빌드 설정 불필요 — 정적 사이트로 자동 인식)
4. 1분 정도 후 `https://pb-crm-xxxx.vercel.app` 주소가 생성됩니다.

## 5단계. 팀원 초대

1. 생성된 주소를 팀원 2명에게 전달
2. 각자 접속해서 **회원가입** (이름 + 이메일 + 비밀번호)
3. 3명이 가입하면 자동으로 추가 가입이 차단됩니다.
4. 가입한 팀원의 이름이 고객 등록 시 '담당자' 선택지로 자동으로 나타납니다.

---

## 이후 수정하는 방법

- GitHub 저장소에서 파일을 수정하고 Commit 하면 **Vercel이 자동으로 재배포**합니다.
- 기능 추가/수정은 Claude에게 "이 파일에 ○○ 기능 추가해줘" 라고 요청한 뒤,
  받은 파일을 GitHub에 다시 올리면 됩니다. (본격적으로 개발하려면 Claude Code 사용 권장)

## 자주 묻는 질문

**Q. 비용이 드나요?**
GitHub, Vercel, Supabase 모두 무료 플랜으로 충분합니다. (Supabase 무료: DB 500MB)
단, Supabase 무료 플랜은 1주일간 접속이 없으면 일시정지될 수 있으니 주기적으로 사용하세요.

**Q. 데이터는 안전한가요?**
로그인한 팀원만 데이터를 읽고 쓸 수 있도록 보안 규칙(RLS)이 설정되어 있습니다.
다만 고객 실명, 연락처 등 민감한 개인정보는 회사의 개인정보 처리 규정을 먼저 확인하시고,
가능하면 이니셜/관리번호로 입력하는 것을 권장합니다.

**Q. 4번째 사람이 가입하려고 하면?**
데이터베이스에서 자동으로 차단되며 "가입 정원(3명)이 모두 찼습니다" 메시지가 표시됩니다.
정원을 바꾸려면 supabase-schema.sql 의 `>= 3` 부분을 원하는 숫자로 바꿔 다시 실행하세요.

**Q. 백업은?**
Supabase 대시보드 → Table Editor 에서 각 테이블을 CSV로 내려받을 수 있습니다.

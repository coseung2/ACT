# 노트북에서 aict.app 돌리기

Cloudflare Workers 대신 **연결된 노트북을 서버로** 쓰는 절차. 앱 코드는 그대로이고,
Cloudflare 바인딩 자리에 `node/` 어댑터가 들어간다(D1→sqlite, R2→파일, Images→sharp).

## 준비물

- Node 22 이상, `npm install`(better-sqlite3·sharp 포함)
- cloudflared (`winget install Cloudflare.cloudflared`)
- Cloudflare 계정의 `aict.app` 존

## 1) 데이터 가져오기

```bash
npm run db:export     # .data/act.sql ← 운영 D1 덤프(--remote)
npm run db:import     # .data/act.db ← .data/act.sql (임시 파일에 적용 후 교체)
npm run db:media      # .data/uploads ← R2 객체(작품 썸네일·영상)
```

`db:media`는 DB에서 키를 뽑아 `wrangler r2 object get`으로 하나씩 복사한다. 이미 있는 파일은 건너뛴다.
운영 데이터를 계속 최신으로 받고 싶으면 1)을 주기적으로 다시 돌린다(전환 전까지만).

## 2) 실행

```bash
npm run build:node    # .next 생성(Workers 빌드는 .open-next 별도)
npm run start:node    # 3100? 기본 3000 — 터널 ingress와 포트를 맞춘다
```

- 터널 `act-aict-app`의 ingress는 `aict.app → http://127.0.0.1:3100` 으로 설정돼 있다.
  다른 포트를 쓰려면 Cloudflare 대시보드(Networks → Tunnels → 설정)에서 맞춘다.
- 환경변수가 필요하면 `.env` 또는 실행 환경에 넣는다(세션·관리자 비밀번호 등은 Infisical에서).

## 3) 터널

```bash
cloudflared tunnel run --token "$(cat .data/tunnel-token)"
```

- 토큰은 `GET /accounts/{id}/cfd_tunnel/{tid}/token`으로 받아 `.data/tunnel-token`에 둔다(저장소에 커밋 금지).
- 터널 상태는 API(`GET /accounts/{id}/cfd_tunnel/{tid}`)로 확인한다. `status: healthy`, `connections ≥ 1`이면 연결됨.

## 4) 도메인 전환 (대시보드, 한 번만)

wrangler 토큰에는 DNS 편집 권한이 없어 API로는 못 바꾼다. Cloudflare 대시보드에서:

1. **DNS → aict.app** 레코드를 `CNAME` → `<터널ID>.cfdargot.net` (Proxy 켜짐)으로 바꾼다.
   터널ID: `5fa61f76-6336-4979-9f02-d11c7ea920c3`
2. **Workers & Pages → act → Settings → Domains & Routes**에서 `aict.app` 커스텀 도메인을 **제거**한다.
   (먼저 DNS를 바꾸고 나서 제거해야 사이트가 끊기지 않는다.)

전환 확인:

```bash
curl -sI https://aict.app | head -3
curl -s https://aict.app/arcade | grep -o 'labelText">[^<]*' | head -3
```

되돌리려면: 2)에서 커스텀 도메인을 다시 추가하면 원래 Worker가 응답한다.

## 5) 상시 운영

- 로그온 시 자동 시작: 시작 프로그램 폴더에 런처를 둔다. 작업 스케줄러의 "로그온할 때" 작업은
  관리자 권한이 필요해 `Register-ScheduledTask`가 0x80070005로 실패한다.

  ```
  %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\act-host.cmd
  ```

  내용(이미 만들어 두었다. 새 PC에서는 아래처럼 만든다):

  ```bat
  @echo off
  call "C:\path\to\ACT\scripts\start-host.cmd"
  ```

  절전은 끄고(전원 설정), 노트북 덮개를 닫아도 동작하도록 설정한다.
- 터널과 앱은 셸과 분리해 띄운다. `start-host.cmd`가 PowerShell `Start-Process`로 감시자를 실행하므로
  런처 셸이 끝나도 감시자·앱·터널은 계속 돈다. 다만 Windows에서 **로그아웃하면 그 사용자 세션의 프로세스는
  모두 끝난다** — 로그아웃 상태에서도 사이트를 운영하려면 앱과 터널 모두 세션 밖에서 실행해야 한다
  (관리자 권한으로 `cloudflared service install <토큰>`, 앱은 작업 스케줄러의 "부팅 시" 실행).
  서비스 등록이 어려우면 로그온 상태를 유지한다(화면 잠금은 무관, 절전만 끄면 된다).
- 백업: `npm run db:backup` → `.data/backups/act-*.db`(최근 14개 유지). 작업 스케줄러에 하루 1회(03:30) 등록해 두었다.
- 업로드는 `.data/uploads/`에 쌓인다. 이 디렉터리와 `.data/act.db`가 곧 원본이므로 다른 디스크로도 복사해 둔다.

## 확인된 것 / 남은 것

- 확인: 노트북에서 `/` `/works` `/arcade` `/works/[slug]` 200, `/media/*.webp` 200, D1·R2 이전(작품 113개·객체 217개), 터널 healthy, aict.app이 노트북에서 응답.
- 남음: 로그인 후 업로드 흐름, 재부팅 후 자동 시작 실제 동작, 노트북 상시 가동 점검.

# Skill Vault

[English](README.md) | 한국어

Skill Vault는 Agent Skill 탐색에 사용되는 컨텍스트를 측정하고, 사용자가 승인한 독립형 Codex 스킬만 완전히 롤백 가능한 명시적 프록시 뒤로 격리합니다. 기존 `$skill-name` 호출 방식은 바뀌지 않습니다.

Codex는 이미 점진적 공개를 사용하므로 전체 `SKILL.md` 본문은 세션 시작이 아니라 활성화 시 로드됩니다. 따라서 Skill Vault는 본문만 큰 스킬에는 **조치 불필요**를 반환하고, discovery metadata가 실제 초기 컨텍스트를 많이 차지할 때만 격리를 추천합니다.

## 요구 사항

- Node.js 20 이상
- 가역적 격리는 Codex 대상이며, Claude Code는 v0.1에서 읽기 전용 진단만 지원

## CLI 설치

npm 설치:

```bash
npm install --global skill-vault
skill-vault init
```

검토한 저장소에서 직접 설치:

```bash
git clone https://github.com/ssauma/skill-vault.git
cd skill-vault
./scripts/install.sh
```

변경 없이 설치 계획만 확인:

```bash
./scripts/install.sh --dry-run
```

npm 패키지는 `postinstall` 같은 생명주기 변경 훅을 사용하지 않습니다. `init`은 읽기 전용이며 계획, 프록시, 상태 파일, 설정 변경을 만들지 않습니다.

## 스킬 플러그인 설치

### Codex

```bash
codex plugin marketplace add ssauma/skill-vault
codex plugin add skill-vault@skill-vault
```

새 세션에서 `$skill-vault`를 명시적으로 실행합니다.

### Claude Code

```text
/plugin marketplace add ssauma/skill-vault
/plugin install skill-vault@skill-vault
```

`/skill-vault:skill-vault`를 실행합니다. Claude Code는 v0.1에서 읽기 전용입니다.

## 진단과 적용

```bash
skill-vault doctor
skill-vault doctor --json
skill-vault plan --skill /absolute/path/to/SKILL.md
skill-vault apply PLAN_ID
skill-vault status
```

`apply`는 사전에 검토한 계획이 있어야 실행됩니다. 원본을 보존하고, 마커로 구분된 Codex 비활성화 설정과 원래 스킬 이름을 가진 `allow_implicit_invocation: false` 프록시를 추가합니다. 적용 또는 롤백 후 Codex를 재시작해야 합니다.

전체 명령 계약은 [docs/cli.md](docs/cli.md)에 있습니다.

아키텍처와 비동기 컨텍스트의 경계는 [docs/design.md](docs/design.md)에 정리되어 있습니다. v0.1은 대상 스킬의 동작 보존을 호스트가 안정적으로 보장하기 전까지 백그라운드 실행이나 강제 서브에이전트 실행을 사용하지 않습니다.

## 롤백과 삭제

패키지를 유지한 채 모든 변경을 롤백:

```bash
skill-vault rollback --all
```

저장소 체크아웃에서 롤백을 검증한 다음 전역 npm 패키지를 삭제:

```bash
./scripts/uninstall.sh
```

복구 상태는 기본적으로 보존됩니다. 롤백 성공 후 상태까지 삭제하려면 다음을 실행합니다.

```bash
./scripts/uninstall.sh --purge
```

드리프트가 발견되면 npm 삭제 전에 중단합니다. 전역 CLI가 손상된 경우 저장소에 포함된 CLI로 복구를 시도합니다. 호스트 플러그인은 롤백 성공 후 호스트 공식 명령으로 별도 제거합니다.

## 안전 모델

- 세션 시작 훅, 프롬프트 훅, 파일 감시자, 백그라운드 데몬 없음
- npm 설치와 최초 진단 중 변경 없음
- 원본 스킬 편집·이동·삭제 없음
- 설정 전체 스냅샷 복원 없음
- 자동 격리 또는 승인 추정 없음
- 생성된 플러그인 캐시와 시스템 스킬은 변경하지 않음
- 파괴적 롤백 전에 소유 파일 해시를 정확히 검증
- 롤백은 원본을 다시 활성화하기 전에 프록시를 비노출 격리하며, 중단된 정리는 저널을 통해 재개

## 개발

```bash
npm test
```

## 라이선스

MIT

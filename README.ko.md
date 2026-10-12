# 한국어 웹 주석 도구

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · **한국어**

한자어는 본문에 한자, 위쪽에 원래 한글을 표시합니다. 외래어는 한글을 유지하고 위쪽에 원어를 표시합니다. 사전을 가져오면 서버나 모델 API 없이 로컬에서 사용할 수 있습니다.

## 설치 및 업데이트

1. [Release](https://github.com/aetherion-nox/korean-web-annotator/releases/tag/v1.1.0)의 **Assets**에서 `Korean-Web-Annotator-v1.1.0.zip`을 내려받아 압축을 풉니다.
2. Chrome의 `chrome://extensions`에서 개발자 모드를 켜고, 압축 해제된 확장 프로그램 로드 기능으로 `manifest.json`이 있는 폴더를 선택합니다. 휴대폰에서는 Quetta의 확장 프로그램 로드 기능을 사용합니다.
3. 업데이트할 때 파일을 교체하고 확장 프로그램을 다시 로드한 뒤 웹 페이지를 새로 고칩니다.

Release의 전체 설치 패키지를 사용하세요. Python은 필요하지 않습니다.

## 사전 가져오기

1. 같은 Release의 **Assets**에서 [hanja_dict.zip](https://github.com/aetherion-nox/korean-web-annotator/releases/download/v1.1.0/hanja_dict.zip)을 내려받습니다.
2. **먼저 압축을 풀어** `hanja_dict.db`를 얻습니다.
3. 엔진 / API 설정에서 DB 파일을 선택하고 사전 가져오기를 누릅니다.

[한국어기초사전 공식 사이트](https://krdict.korean.go.kr/download/downloadPopup)에서 공식 JSON ZIP을 내려받아 압축을 풀지 않고 직접 가져올 수도 있습니다. 두 방법 중 하나를 사용하세요.

## 사용 방법

- 확장 프로그램, 페이지 도구 모음 또는 오른쪽 클릭 메뉴에서 전체 페이지를 처리합니다. 텍스트를 선택해 선택 영역만 처리할 수도 있습니다.
- 실행 취소는 마지막 주석을 취소하고, 복원은 원문으로 되돌립니다.
- 표시된 본문, 본문과 주석, 원래 한국어(기본값), 위쪽 주석만 중에서 복사 방식을 선택합니다.
- 캐시를 무시하고 텍스트 다시 분석 기능으로 텍스트를 다시 처리합니다.

## 모델 API (선택 사항)

설정 화면에서 다음 제공업체와 모델을 선택할 수 있습니다.

| 제공업체 | 모델 |
| --- | --- |
| OpenAI | GPT-6.1 Sol / GPT-6 Astra / GPT-6 Luna |
| Claude (Anthropic) | Sonnet 5.5 / Opus 5.5 / Haiku 5.5 / Fable 5.1 |
| GLM (Z.AI) | GLM-5.3 / GLM-5.3-Flash / GLM-5.3-FlashX |
| Xiaomi MiMo | MiMo-V2.6-Flash / V2.6-Pro / V2.6-Pro-Ultraspeed / V2.5 / V2.5-Pro |
| DeepSeek | deepseek-flash / deepseek-v4-pro |
| 사용자 지정 | OpenAI Chat Completions 호환 주소, 모델명, API 키를 직접 입력 |

제공업체와 모델을 선택하고 API 키를 입력한 뒤 설정을 저장하고 API 테스트로 확인하세요. 추론 설정은 각 모델의 지원 범위에 따라 표시됩니다. 사용자 지정 모델은 서버 기본 설정을 사용합니다. 호환 서비스에는 보통 `/chat/completions`로 끝나는 전체 URL을 입력합니다.

- **모델 검토**: 일반 주석 작업에서 로컬 알고리즘이 해결하지 못한 중의성을 판단합니다.
- **선택 영역 모델 재검토**: 선택한 텍스트를 모델이 다시 판단하도록 요청합니다. API 설정이 필요하지만 일반 검토 스위치를 켤 필요는 없습니다.

## 감사의 말 및 사전 출처

- [Arrow36 / Hangul-Hanja-mixed-script](https://github.com/Arrow36/Hangul-Hanja-mixed-script): 한국어 한자 변환 및 사전 처리 코드를 직접 사용하고 수정했습니다.
- [Furiganator(Chrome 웹 스토어)](https://chromewebstore.google.com/detail/furiganator/ijfcmmkkmogaclaafpgcjdfcfibmhcfa): 일본어 페이지에 후리가나를 추가하는 확장 프로그램으로, 주석 표시와 텍스트 선택 방식에 참고했습니다.
- Kiwi, Pyodide, 국립국어원에 감사드립니다.

DB는 국립국어원 『한국어기초사전』 2026-09-19 공식 데이터를 변환한 비공식 배포본입니다. 텍스트 데이터는 [CC BY-SA 2.0 KR](https://creativecommons.org/licenses/by-sa/2.0/kr/)로 배포합니다. 연결된 미디어에는 별도의 이용 조건이 적용됩니다.

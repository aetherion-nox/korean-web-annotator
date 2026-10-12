# 한국어 웹 주석 도구 1.0.1

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · **한국어**

한국어 웹 페이지에 한자와 외래어의 원어를 표시해 읽기를 돕습니다. 사전을 가져오면 별도의 로컬 서버 없이 브라우저 안에서 사용할 수 있습니다. 자신의 API를 설정해 선택적으로 모델 검토를 사용할 수도 있습니다.

## 설치

1. [Releases](https://github.com/aetherion-nox/korean-web-annotator/releases)에서 정식 버전 1.0.1의 **Assets**에 있는 `Korean-Web-Annotator-v1.0.1.zip`을 다운로드합니다.
2. ZIP의 압축을 풉니다. 전체 런타임이 포함되어 있어 Python 설치나 복원 스크립트 실행이 필요하지 않습니다.
3. Chrome의 `chrome://extensions`에서 개발자 모드를 켜고, 압축 해제된 확장 프로그램 로드 기능으로 `manifest.json`이 있는 폴더를 선택합니다. 휴대폰에서는 Quetta의 확장 프로그램 로드 기능을 사용합니다.

업데이트 후 확장 프로그램을 다시 로드하고 열려 있는 웹 페이지도 새로 고치세요.

**Code → Download ZIP**으로 소스를 받은 경우에는 Python 3.10 이상을 설치하고, 압축을 푼 폴더에서 `python restore_distribution.py`를 실행한 뒤 확장 프로그램을 로드합니다.

## 사전 가져오기

[한국어기초사전 공식 사이트](https://krdict.korean.go.kr/download/downloadPopup)에서 JSON 형식의 사전 ZIP을 다운로드해 확장 프로그램의 엔진 / API 설정에서 가져옵니다. ZIP을 미리 풀 필요는 없습니다. 사전은 별도로 다운로드해야 합니다.

휴대폰에서 가져오기가 느리면 컴퓨터에서 먼저 DB로 변환할 수 있습니다.

```sh
python python/backend/upstream/scripts/import_dictionary.py "path/to/dictionary.zip"
```

생성된 `python/backend/upstream/hanja_dict.db`를 휴대폰으로 옮겨 같은 설정 페이지에서 가져옵니다.

## 사용

- 한국어 웹 페이지를 열고 확장 프로그램, 도구 모음 또는 오른쪽 클릭 메뉴에서 전체 페이지 주석을 시작합니다.
- 텍스트를 선택해 선택 영역에 주석을 달거나 다시 처리할 수 있습니다. 실행 취소 또는 복원 기능으로 주석을 제거할 수 있습니다.
- 복사 방식은 표시된 본문, 본문과 주석, 원래 한국어(기본값), 위쪽 주석만 중에서 선택합니다.
- **모델 검토**: 일반 주석 작업에서 로컬 알고리즘이 해결하지 못한 중의성을 모델이 판단합니다. 제공 업체, 모델, API 키를 설정하고 검토를 켜세요.
- **모델 재주석(선택 영역 재검토)**: 선택한 텍스트를 모델이 다시 판단하도록 직접 요청합니다. 이 기능도 모델 API 설정이 필요하지만, 검토 스위치를 켤 필요는 없습니다.
- 로컬 알고리즘만 사용한 주석에는 모델 API가 필요하지 않습니다.

## 감사의 말

- [Arrow36 / Hangul-Hanja-mixed-script](https://github.com/Arrow36/Hangul-Hanja-mixed-script): 이 확장 프로그램은 해당 프로젝트의 한국어 한자 변환 및 사전 처리 코드를 직접 사용하고 수정했습니다. 오픈 소스 기여에 감사드립니다.
- [Furiganator(Chrome 웹 스토어)](https://chromewebstore.google.com/detail/furiganator/ijfcmmkkmogaclaafpgcjdfcfibmhcfa): 일본어 웹 페이지에 후리가나를 추가하는 확장 프로그램입니다. 주석 표시와 텍스트 선택 방식에 참고했습니다.
- 도구와 사전 자료를 제공하는 Kiwi, Pyodide, 국립국어원에 감사드립니다.

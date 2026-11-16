# Korean Hanja primary-reading dataset provenance

The compact `hanja-reading-data.js` mapping was generated from three tables in the **XeTeX-ko** project by Dohyun Kim:

- `hanja_hangul.tab` — U+4E00-based mapping
- `hanjaexa_hangul.tab` — U+3400-based extension mapping
- `hanjacom_hangul.tab` — U+F900-based compatibility mapping

Source repository: https://github.com/dohyunkim/xetexko

XeTeX-ko copyright (c) 2013–2025 Dohyun Kim. The source is distributed under the **LaTeX Project Public License (LPPL), version 1.3c or later**; see https://www.latex-project.org/lppl/lppl-1-3c/ . The included derived reading data is distributed subject to those source terms. No upstream source font files are redistributed.

**Scope limitation:** This source provides one primary reading for each mapped ideograph, not a complete enumeration of every possible historical, personal-name, or contemporary lexical pronunciation. It may normalize a Sino-Korean initial-sound reading already. The verifier checks simple word-initial patterns but does not claim to resolve all alternate readings. The data is evidence for rejecting obviously incompatible model-generated Hanja, not proof that a matching Hanja string is the correct etymology. The feature remains experimental and model-generated annotations are marked as unverified.

The original dictionary-backed annotations are not phonologically filtered by this experimental mapping.

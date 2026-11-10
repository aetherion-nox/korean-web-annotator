"""Catch stale/missing Python files inside the browser's Pyodide source bundle.

This probes the *packaged* source tree, not Python's regular source folders.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "runtime" / "python-sources.json"

class PackagedPython(unittest.TestCase):
    def test_all_modules_match_exact_repository_sources(self):
        bundle = json.loads(BUNDLE.read_text(encoding="utf-8"))
        source = {
            "/project/" + path.relative_to(ROOT / "python").as_posix():
            path.read_text(encoding="utf-8")
            for path in (ROOT / "python").rglob("*.py")
        }
        self.assertEqual(set(bundle), set(source), "Browser bundle must include all Python modules")
        for name, code in source.items():
            with self.subTest(file=name):
                self.assertEqual(bundle[name], code, f"{name} is stale in Pyodide bundle")
                compile(bundle[name], name, "exec")

    def test_browser_imports_hanja_and_name_helpers_from_packaged_modules(self):
        bundle = json.loads(BUNDLE.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for virtual_path, code in bundle.items():
                self.assertTrue(virtual_path.startswith("/project/"))
                path = root / virtual_path.removeprefix("/project/")
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(code, encoding="utf-8")
            snippet = """
import sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path[:0] = [str(root/'browser-support'), str(root)]
import browser_bridge
browser_bridge.configure(lambda text: '[]', root, root/'data'/'hanja_dict.db')
from backend.analysis import ENGINE_VERSION
from backend.proper_nouns import surname_name_evidence, dictionary_name_evidence
from backend.name_homographs import homograph_target, surname_ambiguity_target
from app.services.quantity import is_dependent_noun
assert ENGINE_VERSION
assert callable(surname_name_evidence) and callable(dictionary_name_evidence)
assert callable(homograph_target) and callable(surname_ambiguity_target)
assert callable(is_dependent_noun)
print('Packaged Pyodide import dependencies: OK')
"""
            result = subprocess.run(
                [sys.executable, "-c", snippet, str(root)],
                capture_output=True, text=True,
                env={**os.environ, "PYTHONPATH": str(root / "browser-support")},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("OK", result.stdout)

if __name__ == "__main__":
    unittest.main(verbosity=2)

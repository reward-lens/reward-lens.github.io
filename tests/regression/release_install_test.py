"""Negative controls for the exact public wheel installation gate."""
from __future__ import annotations

import hashlib
import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "checks" / "release-install.py"
spec = importlib.util.spec_from_file_location("release_install_gate", SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class PublicWheelInstallTests(unittest.TestCase):
    def setUp(self):
        root = os.environ.get("RUNNER_TEMP") or os.environ.get("TMPDIR")
        if not root:
            self.fail("set RUNNER_TEMP or a task-owned TMPDIR for this test")
        self.folder = tempfile.TemporaryDirectory(prefix="site-install-test-", dir=root)
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.wheel_bytes = b"synthetic wheel bytes for a mocked installer"
        self.digest = hashlib.sha256(self.wheel_bytes).hexdigest()
        self.manifest = {
            "schema": "reward-lens.release-artifacts/1",
            "version": "3.1.0",
            "repository": "reward-lens/reward-lens",
            "workflow": ".github/workflows/ci.yml",
            "event": "push",
            "source_sha": "a" * 40,
            "source_tree": "b" * 40,
            "ci_run_id": 42,
            "sha256": {gate.WHEEL: self.digest, gate.SDIST: "c" * 64},
        }
        self.url = "https://files.pythonhosted.org/packages/reward_lens-3.1.0-py3-none-any.whl"
        self.release = {
            "info": {"version": "3.1.0"},
            "urls": [
                {"filename": gate.WHEEL, "digests": {"sha256": self.digest}, "yanked": False, "url": self.url},
                {"filename": gate.SDIST, "digests": {"sha256": "c" * 64}, "yanked": False,
                 "url": "https://files.pythonhosted.org/packages/reward_lens-3.1.0.tar.gz"},
            ],
        }
        self.manifest_path = self.root / "RELEASE_ARTIFACTS.json"
        self.write_manifest()
        self.pip_calls = []

    def write_manifest(self):
        self.manifest_path.write_text(json.dumps(self.manifest), encoding="utf-8")

    def run_install(self, *, wheel_bytes=None):
        def fake_pip(command, **kwargs):
            self.pip_calls.append((command, kwargs, Path(command[-1]).read_bytes()))

        with contextlib.redirect_stdout(io.StringIO()):
            gate.install_public_wheel(
                self.manifest_path,
                get_json=lambda url: self.release,
                get_wheel=lambda url: self.wheel_bytes if wheel_bytes is None else wheel_bytes,
                run=fake_pip,
                temp_root=self.root,
            )

    def test_verified_wheel_is_the_only_pip_requirement_and_env_is_scrubbed(self):
        with patch.dict(os.environ, {"PIP_INDEX_URL": "https://private.invalid/simple", "PIP_CONFIG_FILE": "/old/pip.conf",
                                  "UV_INDEX_URL": "https://private.invalid",
                                  "PYTHONPATH": "/old/checkout", "PYTHONHOME": "/old/python"}):
            self.run_install()
        self.assertEqual(len(self.pip_calls), 1)
        command, kwargs, installed_bytes = self.pip_calls[0]
        self.assertEqual(installed_bytes, self.wheel_bytes)
        self.assertEqual(command[-2], gate.PYPI_INDEX)
        self.assertTrue(command[-1].endswith(gate.WHEEL))
        self.assertEqual(command[1:5], ["-m", "pip", "--isolated", "install"])
        self.assertIn("--no-cache-dir", command)
        self.assertTrue(kwargs["check"])
        for key in ("PIP_INDEX_URL", "UV_INDEX_URL", "PYTHONPATH", "PYTHONHOME"):
            self.assertNotIn(key, kwargs["env"])
        self.assertEqual(kwargs["env"]["PIP_CONFIG_FILE"], os.devnull)

    def test_missing_or_wrong_manifest_prevents_pip(self):
        self.manifest_path.unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_install()
        self.write_manifest()
        self.manifest["source_sha"] = "not-a-sha"
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "source identity"):
            self.run_install()
        self.assertEqual(self.pip_calls, [])

    def test_wrong_public_hash_prevents_pip(self):
        self.manifest["sha256"][gate.WHEEL] = "f" * 64
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "digest or yank mismatch"):
            self.run_install()
        self.assertEqual(self.pip_calls, [])
        self.manifest["sha256"][gate.WHEEL] = self.digest
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "downloaded public wheel SHA-256 mismatch"):
            self.run_install(wheel_bytes=b"corrupt bytes")
        self.assertEqual(self.pip_calls, [])

    def test_untrusted_download_url_prevents_pip(self):
        self.release["urls"][0]["url"] = "https://other.example/packages/wheel.whl"
        with self.assertRaisesRegex(ValueError, "files.pythonhosted.org"):
            self.run_install()
        self.assertEqual(self.pip_calls, [])


if __name__ == "__main__":
    unittest.main()

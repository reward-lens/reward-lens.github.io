"""Install the qualified public wheel, then check the installed distribution."""
from __future__ import annotations

import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import sysconfig
import tempfile
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


VERSION = "3.1.0"
WHEEL = "reward_lens-3.1.0-py3-none-any.whl"
SDIST = "reward_lens-3.1.0.tar.gz"
MANIFEST = Path(__file__).resolve().parents[2] / "release" / "RELEASE_ARTIFACTS.json"
PYPI_RELEASE = f"https://pypi.org/pypi/reward-lens/{VERSION}/json"
PYPI_INDEX = "https://pypi.org/simple"
SHA40 = re.compile(r"[0-9a-f]{40}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
MAX_WHEEL_BYTES = 100 * 1024 * 1024


def _require_https_host(url: str, host: str) -> None:
    parsed = urlsplit(url)
    if (parsed.scheme, parsed.hostname, parsed.port, parsed.username, parsed.password) != (
        "https", host, None, None, None
    ) or parsed.fragment:
        raise ValueError(f"release download must use https://{host}")


def _get_json(url: str) -> dict:
    _require_https_host(url, "pypi.org")
    with urlopen(Request(url, headers={"Accept": "application/json"}), timeout=30) as response:
        _require_https_host(response.geturl(), "pypi.org")
        raw = response.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError("PyPI release metadata is too large")
    return json.loads(raw)


def _get_wheel(url: str) -> bytes:
    _require_https_host(url, "files.pythonhosted.org")
    with urlopen(url, timeout=60) as response:
        _require_https_host(response.geturl(), "files.pythonhosted.org")
        raw = response.read(MAX_WHEEL_BYTES + 1)
    if len(raw) > MAX_WHEEL_BYTES:
        raise ValueError("public wheel exceeds the download bound")
    return raw


def _manifest(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    required = {
        "schema": "reward-lens.release-artifacts/1",
        "version": VERSION,
        "repository": "reward-lens/reward-lens",
        "workflow": ".github/workflows/ci.yml",
        "event": "push",
    }
    if not isinstance(value, dict) or any(value.get(k) != v for k, v in required.items()):
        raise ValueError("qualified release manifest identity mismatch")
    if any(not isinstance(value.get(key), str) or not SHA40.fullmatch(value[key])
           for key in ("source_sha", "source_tree")):
        raise ValueError("qualified release manifest source identity is invalid")
    if type(value.get("ci_run_id")) is not int or value["ci_run_id"] <= 0:
        raise ValueError("qualified release manifest CI run is invalid")
    digests = value.get("sha256")
    if not isinstance(digests, dict) or set(digests) != {WHEEL, SDIST} or any(
        not isinstance(digest, str) or not SHA256.fullmatch(digest) for digest in digests.values()
    ):
        raise ValueError("qualified release manifest distribution hashes are invalid")
    return value


def _public_wheel_url(release: dict, manifest: dict) -> str:
    if not isinstance(release, dict) or not isinstance(release.get("info"), dict) or release["info"].get("version") != VERSION:
        raise ValueError("public PyPI release version mismatch")
    files = release.get("urls")
    if (not isinstance(files, list) or len(files) != 2 or not all(isinstance(file, dict) for file in files)
            or {file.get("filename") for file in files} != {WHEEL, SDIST}):
        raise ValueError("public PyPI release filenames mismatch")
    for file in files:
        if file.get("yanked") or file.get("digests", {}).get("sha256") != manifest["sha256"][file["filename"]]:
            raise ValueError(f"public PyPI digest or yank mismatch for {file['filename']}")
    url = next(file["url"] for file in files if file["filename"] == WHEEL)
    _require_https_host(url, "files.pythonhosted.org")
    return url


def _clean_child_env() -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith(("PIP_", "UV_"))}
    for key in ("PYTHONPATH", "PYTHONHOME", "PYTHONUSERBASE", "PYTHONSTARTUP", "VIRTUAL_ENV"):
        env.pop(key, None)
    env["PIP_CONFIG_FILE"] = os.devnull
    env["PYTHONNOUSERSITE"] = "1"
    return env


def install_public_wheel(
    manifest_path: Path = MANIFEST,
    *,
    get_json=_get_json,
    get_wheel=_get_wheel,
    run=subprocess.run,
    temp_root: Path | None = None,
) -> None:
    manifest = _manifest(manifest_path)
    url = _public_wheel_url(get_json(PYPI_RELEASE), manifest)
    wheel = get_wheel(url)
    actual = hashlib.sha256(wheel).hexdigest()
    if actual != manifest["sha256"][WHEEL]:
        raise ValueError("downloaded public wheel SHA-256 mismatch")
    root = temp_root or os.environ.get("RUNNER_TEMP") or os.environ.get("TMPDIR")
    if not root:
        raise ValueError("set RUNNER_TEMP or task-owned TMPDIR for verified wheel staging")
    with tempfile.TemporaryDirectory(prefix="reward-lens-site-wheel-", dir=root) as folder:
        wheel_path = Path(folder) / WHEEL
        wheel_path.write_bytes(wheel)
        run(
            [sys.executable, "-m", "pip", "--isolated", "install", "--no-input",
             "--no-cache-dir", "--disable-pip-version-check", "--index-url", PYPI_INDEX,
             str(wheel_path)],
            env=_clean_child_env(), check=True, timeout=600,
        )
    print(f"installed public {WHEEL} with SHA-256 {actual}")


def verify_install() -> None:
    dist = metadata.distribution("reward-lens")
    if dist.version != VERSION:
        raise ValueError(f"installed reward-lens {dist.version}, expected {VERSION}")
    direct_url = dist.read_text("direct_url.json")
    if direct_url and json.loads(direct_url).get("dir_info", {}).get("editable"):
        raise ValueError("installed reward-lens is editable")
    import reward_lens

    origin = Path(reward_lens.__file__).resolve()
    site_roots = {Path(sysconfig.get_path(name)).resolve() for name in ("purelib", "platlib")}
    if not any(origin.is_relative_to(root) for root in site_roots):
        raise ValueError(f"reward_lens import is outside active site-packages: {origin}")
    if getattr(reward_lens, "__version__", None) != VERSION:
        raise ValueError(f"reward_lens.__version__ is not {VERSION}")
    child_env = _clean_child_env()
    subprocess.run([sys.executable, "-m", "pip", "--isolated", "check"], env=child_env, check=True, timeout=60)
    cli = Path(sysconfig.get_path("scripts")) / "reward-lens"
    if not cli.is_file():
        raise ValueError(f"installed CLI missing from active Python scripts path: {cli}")
    result = subprocess.run([str(cli), "--help"], env=child_env, check=True, capture_output=True, text=True, timeout=30)
    if "reward-lens" not in result.stdout.lower():
        raise ValueError("installed CLI help does not identify reward-lens")
    print(f"public reward-lens {VERSION} metadata, site-packages origin, dependencies, runtime, and CLI verified")


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--install"]:
            install_public_wheel()
        elif not sys.argv[1:]:
            verify_install()
        else:
            raise ValueError("usage: release-install.py [--install]")
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"release-install: {exc}") from exc

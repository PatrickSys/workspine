"""Black-box oracle for the pinned itsdangerous FIPS import case.

The oracle receives only a candidate source root.  It checks the observable
import/default/explicit digest behavior and (when available) runs the
candidate's own tests.  It contains no reference patch or expected source
shape.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def run_python(source: Path, code: str, timeout: int = 60) -> dict[str, object]:
    env = os.environ.copy()
    env.update({"PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1"})
    env["PYTHONPATH"] = str(source / "src")
    process = subprocess.run(
        [sys.executable, "-c", code],
        cwd=source,
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return {
        "exit": process.returncode,
        "stdout_sha256": hashlib.sha256(process.stdout.encode()).hexdigest(),
        "stderr_sha256": hashlib.sha256(process.stderr.encode()).hexdigest(),
        "diagnostic": (process.stderr or process.stdout)[-2000:],
    }


def default_failure_class(result: dict[str, object]) -> str:
    diagnostic = str(result.get("diagnostic", "")).lower()
    if result.get("exit") == 0:
        return "default_accepted"
    if re.search(r"sha[-_ ]?1|sha1|fips|disabled|unavailable|not available", diagnostic):
        return "sha1_unavailable"
    return "unexpected_failure"


def main() -> int:
    parser = argparse.ArgumentParser(description="black-box itsdangerous SHA-1 oracle")
    parser.add_argument("--source", required=True, type=Path)
    args = parser.parse_args()
    source = args.source.resolve()
    if not source.is_dir() or not (source / "src").is_dir():
        raise SystemExit("source must contain a src directory")

    import_code = "import hashlib; del hashlib.sha1; import itsdangerous.signer"
    explicit_code = (
        "import hashlib; del hashlib.sha1; from itsdangerous import Signer; "
        "s=Signer(b'key', digest_method=hashlib.sha256); "
        "assert s.unsign(s.sign(b'payload')) == b'payload'"
    )
    default_code = (
        "import hashlib; del hashlib.sha1; from itsdangerous import Signer; "
        "Signer(b'key').sign(b'payload')"
    )
    import_result = run_python(source, import_code)
    explicit_result = run_python(source, explicit_code)
    default_result = run_python(source, default_code)

    tests = None
    if (source / "tests").is_dir():
        test_process = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", "--disable-warnings", "--maxfail=1"],
            cwd=source,
            env={**os.environ, "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONPATH": str(source / "src")},
            capture_output=True,
            text=True,
            timeout=180,
        )
        tests = {"exit": test_process.returncode}

    checks = {
        "import_with_sha1_unavailable": import_result["exit"] == 0,
        "explicit_sha256_signer": explicit_result["exit"] == 0,
        "default_sha1_rejected": default_failure_class(default_result) == "sha1_unavailable",
    }
    if tests is not None:
        checks["upstream_tests_pass"] = tests["exit"] == 0
    passed = all(checks.values())
    print(json.dumps({
        "status": "pass" if passed else "fail",
        "checks": checks,
        "diagnostics": {"default": {"classification": default_failure_class(default_result), "tail": default_result["diagnostic"]}},
    }, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
